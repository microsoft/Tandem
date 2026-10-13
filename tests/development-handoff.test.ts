import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, link, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
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
import { HumanLoopStore } from "../stage2/tandem/src/human-loop-store.mjs";
import { createDurablePrivateSession } from "../stage2/tandem/src/human-loop-controller.mjs";
import { createHumanTask, humanTaskPrompt } from "../stage2/tandem/src/human-loop-task.mjs";
import { waitFor } from "../stage2/tandem/test/helpers/native-session-fixture.mjs";

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

test("handoff status inspection is exact, read-only and never admits work", async t => {
    const f = await fixture("build");
    t.after(f.cleanup);
    assert.equal(await f.store.admissionFor(f.state), null);
    const receipt = await f.store.prepare(f.state);
    f.state.development = { handoffId: receipt.id, requestId: receipt.request.id, snapshotPath: receipt.source.snapshotPath };
    const path = join(f.store.root, `${receipt.id}.admission.json`);
    const prepared = await f.store.admissionFor(f.state);
    assert.equal(prepared?.status, "prepared");
    for (const status of ["prepared", "sending", "uncertain", "admitted"] as const) {
        await writeJsonAtomically(path, { ...prepared, status, privateSessionId: status === "prepared" ? null : "private" });
        const before = await retainedFiles(f.store.root);
        assert.equal((await f.store.admissionFor(f.state))?.status, status);
        assert.deepEqual(await retainedFiles(f.store.root), before);
    }
    await assert.rejects(new DevelopmentHandoffs(f.workspace, f.shared, "other-main").admissionFor(f.state), /another workspace or owner/);
    await assert.rejects(f.store.admissionFor({ ...f.state, generation: "other-generation" }), /current effort/);
    const next = structuredClone(f.state);
    next.lifecycle.outputs[0].path = ".tandem/efforts/fixture/stages/prototype-r5.json";
    assert.equal(await f.store.admissionFor(next), null, "An old admission is not completion of a newly saved input.");
    await writeJsonAtomically(path, { ...prepared, requestId: "foreign" });
    await assert.rejects(f.store.admissionFor(f.state), /admission is unavailable or invalid/);
    await writeJsonAtomically(path, prepared);
    await writeFile(f.path, "{}");
    await assert.rejects(f.store.admissionFor(f.state), /Prototype changed/);
});

test("empty-setup repair inspection preserves prepared handoffs and refuses every admission or owner change", async t => {
    const f = await fixture("build");
    t.after(f.cleanup);
    const receipt = await f.store.prepare(f.state);
    const before = await retainedFiles(f.store.root);
    const proof = await f.store.inspectUnadmitted();
    assert.match(JSON.stringify(proof), /prepared/);
    assert.deepEqual(await retainedFiles(f.store.root), before);
    const path = join(f.store.root, `${receipt.id}.admission.json`);
    const original = JSON.parse(await readFile(path, "utf8"));
    for (const status of ["sending", "admitted", "uncertain"]) {
        await writeJsonAtomically(path, { ...original, status, privateSessionId: "private" });
        const bytes = await readFile(path);
        await assert.rejects(f.store.inspectUnadmitted(), /used or uncertain/);
        assert.deepEqual(await readFile(path), bytes);
    }
    await writeJsonAtomically(path, original);
    await assert.rejects(new DevelopmentHandoffs(f.workspace, f.shared, "other-main").inspectUnadmitted(), /ownership|another|target/i);
});

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
    let unavailable = false, clients = 0, sends = 0, creations = 0;
    let nativeSessionId: string | undefined;
    const nativeHistory: unknown[] = [];
    const observations = new Map<string, () => unknown | Promise<unknown>>();
    type NativeEvent = { id: string; type: string; parentId: string | null; timestamp: string; data: Record<string, unknown> };
    type SendInput = { prompt: string; mode: string; agentMode: string; attachments?: unknown[] };
    let onSend: ((input: SendInput, emit: (event: NativeEvent) => void) => Promise<string>) | null = null;
    let creationFailure = false;
    class NoModelClient {
        constructor() { clients++; }
        async start() {}
        async createSession(config) {
            creations++;
            if (creationFailure) throw new Error("Native create result was not acknowledged.");
            nativeSessionId = config.sessionId;
            return this.resumeSession(config.sessionId, { ...config, continuePendingWork: false, suppressResumeEvent: true });
        }
        async getSessionMetadata(sessionId: string) {
            if (observations.has("metadata")) return observations.get("metadata")!();
            return sessionId === nativeSessionId ? { sessionId, isRemote: false } : undefined;
        }
        rpc = { sessions: {
            open: async ({ options }: { options: { sessionId: string } }) => {
                creations++;
                if (creationFailure) throw new Error("Native create result was not acknowledged.");
                nativeSessionId = options.sessionId;
                return { status: "created", sessionId: options.sessionId };
            },
            save: async () => {},
            checkInUse: async () => observations.has("inUse") ? observations.get("inUse")!() : { inUse: [] },
            getSizes: async () => observations.has("storage") ? observations.get("storage")!()
                : { sizes: nativeSessionId ? { [nativeSessionId]: 1 } : {} },
            readPersistedEvents: async () => ({ cursorStatus: "ok", events: [...nativeHistory], hasMore: false }),
        } };
        async resumeSession(sessionId: string, config: { requestExtensions: boolean; continuePendingWork: boolean;
            suppressResumeEvent: boolean; onEvent: (event: NativeEvent) => void }) {
            assert.equal(config.requestExtensions, false);
            assert.equal(config.continuePendingWork, false);
            assert.equal(config.suppressResumeEvent, true);
            return {
                sessionId, abort: async () => {}, getEvents: async () => [...nativeHistory],
                disconnect: async () => {},
                rpc: {
                    name: { set: async () => {} },
                    mode: { get: async () => "interactive" },
                    metadata: { isProcessing: async () => ({ processing: false }), activity: async () => ({ hasActiveWork: false }) },
                    queue: { pendingItems: async () => ({ items: [], steeringMessages: [] }) },
                    permissions: { resetSessionApprovals: async () => ({ success: true }) },
                    tasks: { list: async () => ({ tasks: [] }) },
                },
                send: async (input: SendInput) => {
                    sends++;
                    if (!onSend) assert.fail("Startup and retained-request reconciliation must not send a model turn.");
                    return onSend(input, event => { nativeHistory.push(event); config.onEvent(event); });
                },
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
            createPrivateSession: config => createDurablePrivateSession(options.client, config, options.afterNativeCreate),
            contextProvider: () => f.store.context(),
            onHandoff: async () => assert.fail("Opening storage must not publish a model outcome."),
        }),
    };
    return { configuration, create: () => new HumanLoopInstallation(options),
        setUnavailable(value: boolean) { unavailable = value; }, counts: () => ({ clients, sends }),
        creations: () => creations, observations, setCreationFailure(value: boolean) { creationFailure = value; },
        setMainSessionId(value: string) { main.sessionId = value; },
        appendHistory(events: NativeEvent[]) { nativeHistory.push(...structuredClone(events)); },
        history: () => structuredClone(nativeHistory),
        setSendHandler(handler: NonNullable<typeof onSend>) { onSend = handler; } };
}

async function legacyColdFixture() {
    const f = await fixture("build"), native = await installationFixture(f);
    const handoff = await f.store.prepare(f.state), bytes = await retainedFiles(f.store.root);
    const file = new HostStateFile(f.workspace, join(f.workspace, ".tandem", "living-canvas", "human-loop", "installation.json"));
    const original = { schemaVersion: "human-loop-installation/v2", phase: "prepared", configuration: native.configuration,
        reason: null, closeId: null, closeProof: null, reopenId: null };
    await file.mutate("human-loop-prepare", () => ({ content: JSON.stringify(original), result: null }));
    await new HumanLoopStore(native.configuration.owner).initialize({ revisionId: null, digest: null });
    await file.mutate("human-loop-installation:creating", () => ({ content: JSON.stringify({ ...original, phase: "creating" }), result: null }));
    const first = native.create();
    await assert.rejects(first.open(), /not a git repository/);
    const firstFailure = (await first.read()).reason;
    await assert.rejects(first.close(), /never reached Ready/);
    assert.ok(JSON.parse((await file.read())!).closeId, "Normal Stop retains an unconfirmed close intent.");
    await getHostStateWal(f.workspace).close();
    execFileSync("git", ["init", "--quiet"], { cwd: f.workspace });
    const cold = native.create();
    await assert.rejects(cold.open({ retry: true }), /session is unavailable/);
    assert.equal(native.creations(), 0);
    await assert.rejects(cold.close(), /never reached Ready/);
    await getHostStateWal(f.workspace).close();
    return { ...f, native, handoff, bytes, file, cold: native.create(), firstFailure };
}

test("legacy v2 non-Git failure needs explicit bound recovery and keeps the original reserved ID, handoff and audit", async () => {
    const f = await legacyColdFixture();
    try {
        const original = await f.file.read(), before = await readFile(getHostStateWal(f.workspace).path);
        await assert.rejects(f.cold.open(), /not a git repository[\s\S]*Retry runtime/);
        const proof = await f.cold.requestInitialCreationRecovery();
        assert.equal(proof.privateSessionId, f.native.configuration.owner.privateSessionId);
        assert.match(proof.reason, /not a git repository/);
        assert.match(proof.message, /No model request or implementation/);
        assert.equal(f.native.creations(), 0);
        assert.equal(await f.file.read(), original, "Inspecting never grants creation or rewrites startup state.");
        await f.cold.decideInitialCreationRecovery({ confirmationId: proof.confirmationId, approve: false });
        assert.equal(await f.file.read(), original);
        const confirmed = await f.cold.requestInitialCreationRecovery();
        const outcome = await f.cold.decideInitialCreationRecovery({ confirmationId: confirmed.confirmationId, approve: true });
        assert.equal(outcome.recovered, true);
        assert.deepEqual(f.cold.configuration.owner, f.native.configuration.owner);
        assert.equal((await f.cold.read()).status, "ready");
        assert.equal((await f.cold.read()).reason, null, "Ready must not display the archived failure as a current error.");
        const runtime = f.cold.runtime, state = await runtime.store.load();
        assert.equal(state.requests.length, 0);
        assert.equal(state.executions.length, 0);
        assert.match(state.recoveries[0].uncertainty.reason, /Restart cannot accept/);
        assert.deepEqual(await retainedFiles(f.store.root), f.bytes);
        assert.deepEqual(await f.store.prepare(f.state), f.handoff);
        const installation = JSON.parse((await f.file.read())!);
        assert.equal(installation.schemaVersion, "human-loop-installation/v3");
        assert.equal(installation.nativeCreation.status, "created");
        assert.equal(installation.nativeCreation.authorization.id, confirmed.confirmationId);
        assert.equal(installation.nativeCreation.authorization.consumedAt, installation.nativeCreation.requestedAt);
        assert.match(installation.initialFailure, /not a git repository/);
        const after = await readFile(getHostStateWal(f.workspace).path);
        assert.ok(after.subarray(0, before.length).equals(before));
        const duplicate = await f.cold.decideInitialCreationRecovery({ confirmationId: confirmed.confirmationId, approve: true });
        assert.equal(duplicate.duplicate, true);
        assert.equal(f.native.creations(), 1);
        assert.equal(f.native.counts().sends, 0);
        await f.cold.close();
    } finally { await f.cleanup(); }
});

for (const [label, observation, value] of [
    ["existing session", "metadata", { sessionId: "fixture-private", isRemote: false }],
    ["foreign metadata", "metadata", { sessionId: "foreign", isRemote: true }],
    ["indeterminate metadata", "metadata", null],
    ["active native owner", "inUse", { inUse: ["fixture-private"] }],
    ["malformed native ownership", "inUse", { inUse: null }],
    ["retained native history", "storage", { sizes: { "fixture-private": 120 } }],
    ["empty retained native storage", "storage", { sizes: { "fixture-private": 0 } }],
    ["indeterminate native storage", "storage", { sizes: null }],
    ["incomplete paginated inventory", "storage", { sizes: {}, hasMore: true }],
    ["malformed storage measurement", "storage", { sizes: { other: -1 } }],
] as const) {
    test(`unused-setup recovery rejects ${label} without issuing native creation`, async () => {
        const f = await legacyColdFixture();
        try {
            f.native.observations.set(observation, () => value);
            await assert.rejects(f.cold.requestInitialCreationRecovery(), /exists|indeterminate|unverified|active|storage/);
            assert.equal(f.native.creations(), 0);
            assert.deepEqual(await retainedFiles(f.store.root), f.bytes);
        } finally { await f.cleanup(); }
    });
}

for (const observation of ["metadata", "inUse", "storage"]) {
    test(`unused-setup recovery never treats a failed ${observation} query as native absence`, async () => {
        const f = await legacyColdFixture();
        try {
            f.native.observations.set(observation, () => { throw new Error(`Fixture ${observation} observation failed`); });
            await assert.rejects(f.cold.requestInitialCreationRecovery(), /observation failed/);
            assert.equal(f.native.creations(), 0);
        } finally { await f.cleanup(); }
    });
}

test("unused-setup authorization is stale after state drift and consumed before an ambiguous native create", async () => {
    const f = await legacyColdFixture();
    try {
        const stale = await f.cold.requestInitialCreationRecovery();
        await f.file.mutate("human-loop-installation:unknown", content => ({
            content: JSON.stringify({ ...JSON.parse(content!), reason: "A newer startup observation" }), result: null,
        }));
        await assert.rejects(f.cold.decideInitialCreationRecovery({ confirmationId: stale.confirmationId, approve: true }), /changed since confirmation/);
        assert.equal(f.native.creations(), 0);
        const current = await f.cold.requestInitialCreationRecovery();
        f.native.setCreationFailure(true);
        await assert.rejects(f.cold.decideInitialCreationRecovery({ confirmationId: current.confirmationId, approve: true }), /not acknowledged/);
        const issued = JSON.parse((await f.file.read())!);
        assert.equal(issued.nativeCreation.status, "requested");
        assert.equal(issued.nativeCreation.authorization.id, current.confirmationId);
        assert.equal(f.native.creations(), 1);
        f.native.setCreationFailure(false);
        await assert.rejects(f.cold.open({ retry: true }), /session is unavailable/);
        await assert.rejects(f.cold.requestInitialCreationRecovery(), /legacy incomplete/);
        await assert.rejects(f.cold.decideInitialCreationRecovery({ confirmationId: current.confirmationId, approve: true }), /stale or already consumed/);
        assert.equal(f.native.creations(), 1);
        assert.equal(f.native.counts().sends, 0);
    } finally { await f.cleanup(); }
});

for (const prior of ["ready", "closed", "confirmed-close", "invalid-close-proof", "admitted-work", "native-control", "foreign-owner", "forged-close", "invalid-closing"]) {
    test(`unused-setup recovery refuses retained ${prior} evidence`, async () => {
        const f = await legacyColdFixture();
        try {
            if (prior === "ready" || prior === "closed") {
                await f.file.mutate(`human-loop-installation:${prior}`, content => ({ content: JSON.stringify({ ...JSON.parse(content!), phase: prior }), result: null }));
                await f.file.mutate("human-loop-installation:unknown", content => ({ content: JSON.stringify({ ...JSON.parse(content!), phase: "unknown" }), result: null }));
            } else if (prior === "confirmed-close" || prior === "invalid-close-proof") {
                await f.file.mutate("human-loop-installation:unknown", content => {
                    const record = JSON.parse(content!);
                    return { content: JSON.stringify({ ...record, closeProof: {
                        schemaVersion: "human-loop-close/v2", id: record.closeId,
                        ownerDigest: policyHash(f.native.configuration.owner), configurationDigest: policyHash(f.native.configuration),
                        native: { schemaVersion: "human-loop-native-close/v2", sessionId: "fixture-private", saved: true,
                            closed: prior === "confirmed-close", warnings: [] },
                        warnings: [], closedAt: new Date().toISOString(),
                    } }), result: null };
                });
            } else if (prior === "admitted-work") {
                await new HumanLoopStore(f.native.configuration.owner).dispatch("user", `receive:${f.handoff.request.id}`, "receive-request", f.handoff.request);
            } else if (prior === "native-control") {
                const control = new HostStateFile(f.workspace, join(f.workspace, ".tandem", "living-canvas", "native-permissions", "approvals.json"));
                await control.mutate("fixture-native-approval", () => ({ content: '{"approved":true}', result: null }));
            } else if (prior === "forged-close") {
                await f.file.mutate("human-loop-installation:unknown", content => ({
                    content: JSON.stringify({ ...JSON.parse(content!), closeId: randomUUID() }), result: null,
                }));
            } else if (prior === "invalid-closing") {
                await f.file.mutate("human-loop-installation:closing", content => ({
                    content: JSON.stringify({ ...JSON.parse(content!), phase: "closing", closeId: null }), result: null,
                }));
                await f.file.mutate("human-loop-installation:unknown", content => ({
                    content: JSON.stringify({ ...JSON.parse(content!), phase: "unknown" }), result: null,
                }));
            } else f.native.setMainSessionId("foreign-main");
            await assert.rejects(f.cold.requestInitialCreationRecovery(), /prior Ready|legacy incomplete|shutdown has not succeeded|admitted work|native control|another main session|close-intent transitions/);
            assert.equal(f.native.creations(), 0);
        } finally { await f.cleanup(); }
    });
}

test("non-Git preflight reserves no native identity and permits explicit retry after Git initialization", async () => {
    const f = await fixture("build"), native = await installationFixture(f);
    try {
        const handoff = await f.store.prepare(f.state), bytes = await retainedFiles(f.store.root);
        const installation = native.create();
        await assert.rejects(installation.open(), /not a git repository/);
        assert.equal(installation.configuration, null);
        assert.equal(native.creations(), 0);
        await assert.rejects(access(join(f.workspace, ".tandem", "living-canvas", "host-state", "journal.wal")), { code: "ENOENT" });
        execFileSync("git", ["init", "--quiet"], { cwd: f.workspace });
        await installation.open({ retry: true });
        assert.equal((await installation.read()).status, "ready");
        assert.equal(native.counts().sends, 0);
        assert.deepEqual(await retainedFiles(f.store.root), bytes);
        assert.deepEqual(await f.store.prepare(f.state), handoff);
        await installation.close();
    } finally { await f.cleanup(); }
});

test("expired unused-setup confirmation cannot initialize the reserved identity", async t => {
    const f = await legacyColdFixture();
    try {
        const confirmation = await f.cold.requestInitialCreationRecovery();
        const now = Date.now();
        const clock = t.mock.method(Date, "now", () => now + 301_000);
        try {
            await assert.rejects(f.cold.decideInitialCreationRecovery({
                confirmationId: confirmation.confirmationId, approve: true,
            }), /expired/);
            assert.equal(f.native.creations(), 0);
        } finally { clock.mock.restore(); }
    } finally { await f.cleanup(); }
});

test("native state appearing after inspection invalidates one-time setup confirmation", async () => {
    const f = await legacyColdFixture();
    try {
        const confirmation = await f.cold.requestInitialCreationRecovery();
        f.native.observations.set("storage", () => ({ sizes: { "fixture-private": 1 } }));
        await assert.rejects(f.cold.decideInitialCreationRecovery({
            confirmationId: confirmation.confirmationId, approve: true,
        }), /retained native storage/);
        assert.equal(f.native.creations(), 0);
        assert.deepEqual(await retainedFiles(f.store.root), f.bytes);
    } finally { await f.cleanup(); }
});

test("Reconcile preserves the failed-start diagnosis and cannot silently retry or dispatch its handoff", async () => {
    const h = await extensionHarness();
    try {
        const state = h.api.createState("failed-start", "A command-line tool");
        state.stage = state.lifecycle.currentStage = "requirements";
        state.lifecycle.completedStages = ["prepare"];
        state.preparation.status = "ready";
        state.requirements = { substage: "dag", usageItems: ["Use the command"], suggestions: [] };
        state.decisionGraph.nodes = [{ id: "choice", title: "Command behavior", dependencies: [],
            question: null, answer: "Use the CLI", status: "answered" }];
        state.prototypeApproach = { mode: "not-applicable", reason: "CLI only" };
        await h.api.persistState(state);
        h.setBeforeDevelopmentStart(async () => {
            throw new Error("Original pre-native Git failure. Select Retry runtime inside Development.");
        });
        await h.api.completeLifecycleStage(state.prototypeId, "requirements", "project:tandem");
        await assert.rejects(h.api.continueDevelopment(state.prototypeId, "project:tandem"), /Original pre-native Git failure/);
        const saved = await h.api.loadState(state.prototypeId);
        await assert.rejects(h.api.continueDevelopment(state.prototypeId, "project:tandem"), /Original pre-native Git failure.*Retry runtime/);
        const retried = await h.api.loadState(state.prototypeId);
        assert.deepEqual(retried.development, saved.development);
        assert.match(retried.status, /Original pre-native Git failure.*Retry runtime/);
        assert.equal(h.developmentRequests.length, 0);
    } finally { await h.close(); }
});

test("cold Retry completes only the original uncreated private identity after pre-native Git failure", async () => {
    const f = await fixture("build"), native = await installationFixture(f);
    try {
        const receipt = await f.store.prepare(f.state), handoffBytes = await retainedFiles(f.store.root);
        execFileSync("git", ["init", "--quiet"], { cwd: f.workspace });
        const first = native.create();
        await first.prepare();
        const owner = structuredClone(first.configuration.owner);
        // Git can disappear between read-only preflight and the actual workspace validation.
        await rename(join(f.workspace, ".git"), join(f.root, "temporarily-unavailable-git"));
        await assert.rejects(first.open(), /not a git repository/);
        assert.equal(native.creations(), 0);
        const originalFailure = (await first.read()).reason;
        const before = await readFile(getHostStateWal(f.workspace).path);
        await getHostStateWal(f.workspace).close();

        await rename(join(f.root, "temporarily-unavailable-git"), join(f.workspace, ".git"));
        const cold = native.create();
        await assert.rejects(cold.open(), /Retry runtime/);
        assert.equal(native.creations(), 0);
        const runtime = await cold.open({ retry: true });
        assert.equal((await cold.read()).status, "ready");
        assert.deepEqual(cold.configuration.owner, owner);
        assert.equal(runtime.sessionId, owner.privateSessionId);
        assert.equal(native.creations(), 1);
        assert.equal(native.counts().sends, 0);
        assert.equal((await runtime.store.load()).requests.length, 0);
        assert.deepEqual(await f.store.prepare(f.state), receipt);
        assert.deepEqual(await retainedFiles(f.store.root), handoffBytes);
        assert.ok((await readFile(getHostStateWal(f.workspace).path)).subarray(0, before.length).equals(before),
            "Prior startup failure remains in the append-only WAL.");
        assert.match(originalFailure, /not a git repository/);
        await cold.close();
    } finally { await f.cleanup(); }
});

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
        const used = await runtime.store.load(), nativeEvents = native.history();
        const walBefore = await readFile(journal);
        const handoffsBefore = await retainedFiles(f.store.root);
        native.setMainSessionId("different-main");
        await assert.rejects(native.create().open(), /another main session/);
        assert.deepEqual(await runtime.store.load(), used);
        assert.deepEqual(await readFile(journal), walBefore, "A fresh host cannot rewrite used Stage2 ownership or history.");
        assert.deepEqual(native.history(), nativeEvents);
        assert.equal(native.creations(), 1);
        assert.deepEqual(await retainedFiles(f.store.root), handoffsBefore);
    } finally {
        await getHostStateWal(f.workspace).close();
        await f.cleanup();
    }
});

test("legacy failed Router input closes and cold-reopens the same ID without replay, then admits one explicit new continuation", { timeout: 30_000 }, async () => {
    const f = await fixture("build"), native = await installationFixture(f);
    let installation = native.create();
    try {
        execFileSync("git", ["init", "--quiet"], { cwd: f.workspace });
        await writeFile(join(f.workspace, ".gitignore"), ".tandem/\n");
        const receipt = await f.store.prepare(f.state), original = await retainedFiles(f.store.directory(receipt.id));
        let runtime = await installation.open();
        const privateId = runtime.sessionId;
        await runtime.store.dispatch("user", "synthetic-original-request", "receive-request", receipt.request);
        await runtime.store.dispatch("host", "synthetic-original-admission", "admit-request", { requestId: receipt.id });
        const packet = createHumanTask({ id: "synthetic-failed-router", dispatchId: "synthetic-failed-dispatch",
            sessionId: privateId, requestId: receipt.id, role: "router", cycleId: null, internalTaskId: null,
            before: null, design: (await runtime.store.load()).design }, { request: receipt.request, sourceHandoffs: [receipt] });
        await runtime.store.admitTask(packet);
        await runtime.store.dispatch("runtime", "synthetic-original-ack", "role-acknowledged", {
            taskId: packet.binding.id, dispatchId: packet.binding.dispatchId, messageId: "synthetic-sdk-ack",
        });
        const timestamp = new Date().toISOString(), prompt = humanTaskPrompt(packet);
        // Synthetic pre-fix ledger/history, exercised through real Installation, Runtime, store and WAL.
        native.appendHistory([
            { id: "synthetic-native-user", type: "user.message", parentId: null, timestamp,
                data: { content: prompt, transformedContent: prompt, attachments: [], supportedNativeDocumentMimeTypes: [],
                    agentMode: "interactive", delivery: "idle", interactionId: "synthetic-native-interaction",
                    parentAgentTaskId: "00000000-0000-4000-8000-000000000111" } },
            { id: "synthetic-native-start", type: "assistant.turn_start", parentId: "synthetic-native-user", timestamp,
                data: { turnId: "0", interactionId: "synthetic-native-interaction" } },
            { id: "synthetic-refused-tool", type: "tool.execution_start", parentId: "synthetic-native-start", timestamp,
                data: { toolCallId: "synthetic-refused-call", toolName: "read_work_cycle", arguments: {}, turnId: "0" } },
            { id: "synthetic-refused-completion", type: "tool.execution_complete", parentId: "synthetic-refused-tool", timestamp,
                data: { toolCallId: "synthetic-refused-call", turnId: "0", interactionId: "synthetic-native-interaction",
                    success: false, error: { message: "Synthetic pre-fix correlation failure; tool was not admitted." } } },
        ]);
        await runtime.store.dispatch("host", "synthetic-original-failure", "execution-unknown", {
            reason: "Synthetic pre-fix native user event lacked messageId and turnId.", evidenceRef: "synthetic-native-user",
        });
        assert.equal((await f.store.admit(receipt.id, runtime)).status, "admitted");
        const before = await runtime.store.load(), history = native.history();
        assert.equal(before.activeTask!.messageId, "synthetic-sdk-ack");
        assert.equal(Object.hasOwn(before.activeTask!, "inputs"), false);
        const wal = await readFile(getHostStateWal(f.workspace).path);
        await installation.close();
        await getHostStateWal(f.workspace).close();

        installation = native.create();
        runtime = await installation.open();
        runtime.wake(); await runtime.whenIdle();
        const recovered = await runtime.store.load();
        assert.equal(runtime.sessionId, privateId);
        assert.equal(native.creations(), 1);
        assert.equal(native.counts().sends, 0);
        assert.deepEqual(native.history(), history);
        assert.equal(recovered.requests[0]!.status, "retired");
        assert.deepEqual(recovered.executions[0], before.activeTask);
        assert.deepEqual(recovered.recoveries![0]!.uncertainty, before.uncertainty);
        assert.equal(recovered.recoveries![0]!.nativeUsers[0]!.messageId, null);
        assert.equal(recovered.recoveries![0]!.nativeUsers[0]!.interactionId, "synthetic-native-interaction");
        const recoveredUser = recovered.recoveries![0]!.nativeUsers[0]!;
        assert.ok("schemaVersion" in recoveredUser);
        assert.equal(recoveredUser.schemaVersion, "human-loop-native-user/v2");
        assert.equal(recoveredUser.parentAgentTaskId, "00000000-0000-4000-8000-000000000111");
        assert.equal((await runtime.readiness()).status, "ready");
        assert.ok((await readFile(getHostStateWal(f.workspace).path)).subarray(0, wal.length).equals(wal));
        assert.deepEqual(await retainedFiles(f.store.directory(receipt.id)), original);
        assert.match((await f.store.admit(receipt.id, runtime)).message, /retired/);
        assert.equal(native.counts().sends, 0, "Idempotent handoff reconciliation is not a retry.");

        let newPacket: ReturnType<typeof createHumanTask> | undefined;
        native.setSendHandler(async (input, emit) => {
            assert.equal(input.mode, "immediate"); assert.equal(input.agentMode, "interactive");
            newPacket = JSON.parse(input.prompt.split("\n").at(-1)!);
            const timestamp = new Date().toISOString();
            emit({ id: "new-native-user", type: "user.message", parentId: "synthetic-refused-completion", timestamp,
                data: { content: input.prompt, attachments: input.attachments ?? [], interactionId: "new-native-interaction",
                    agentMode: "interactive", delivery: "idle" } });
            emit({ id: "new-native-start", type: "assistant.turn_start", parentId: "new-native-user", timestamp,
                data: { turnId: "1", interactionId: "new-native-interaction" } });
            return "new-sdk-ack";
        });
        await runtime.send({ id: "explicit-new-continuation", receivedAt: new Date().toISOString(), answers: null,
            message: `Continue Design from retained handoff ${receipt.id}; preserve its source and confirmed decisions. Do not implement.` });
        await waitFor(async () => (await runtime.store.load()).activeTask?.interactionId === "new-native-interaction", "new owned Router dispatch");
        assert.equal(native.counts().sends, 1);
        assert.equal(newPacket!.binding.requestId, "explicit-new-continuation");
        assert.notEqual(newPacket!.binding.id, packet.binding.id);
        assert.equal(newPacket!.context.sourceHandoffs[0].id, receipt.id);
        assert.equal(newPacket!.context.sourceHandoffs[0].sourceFingerprint, receipt.prototype.sourceFingerprint);
        assert.equal((await runtime.store.load()).uncertainty, null);
        await installation.close();
        await runtime.whenIdle();
        assert.equal(native.counts().sends, 1);
        assert.deepEqual(await retainedFiles(f.store.directory(receipt.id)), original);
    } finally {
        if ((await installation.read()).status === "ready") await installation.close();
        await f.cleanup();
    }
});

for (const withHandoff of [false, true]) for (const legacy of ["policy", "installation", "ledger"] as const) {
    test(`genuine legacy ${legacy} still requires verified WAL migration${withHandoff ? " alongside a retained handoff" : ""}`, async () => {
        const f = await fixture("build"), native = await installationFixture(f);
        try {
            execFileSync("git", ["init", "--quiet"], { cwd: f.workspace });
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

for (const stage of ["prepare", "requirements"] as const) test(`direct Development HTTP open preserves ${stage} without handoff or model work`, async () => {
    const h = await extensionHarness();
    const state = h.api.createState("direct", stage === "prepare" ? "" : "An existing project");
    state.stage = state.lifecycle.currentStage = stage;
    state.lifecycle.completedStages = stage === "prepare" ? [] : ["prepare"];
    if (stage === "requirements") state.preparation.status = "ready";
    await h.api.persistState(state);
    const entry = await h.api.startServer("direct", "direct", "project:tandem", true);
    try {
        const before = await h.api.loadState("direct");
        const status = await fetch(new URL("api/development/status", entry.url));
        assert.equal(status.status, 200);
        assert.deepEqual((await status.json()).mainSessionModel, { modelId: "fixture-model" });
        assert.equal(h.developmentOpens.length, 0, "Reading the owning model does not initialize Development.");
        let starts = 0;
        h.setBeforeDevelopmentStart(async () => { starts++; });
        const views = [];
        for (let attempt = 0; attempt < 2; attempt++) {
            const presented = await fetch(new URL("api/development/view", entry.url), { method: "POST" });
            assert.equal(presented.status, 200, await presented.clone().text());
            views.push(await presented.json());
        }
        assert.deepEqual(views[0], views[1], "The presentation binding survives repeated view reads.");
        assert.match(views[0].channel, /^[a-zA-Z0-9-]+$/);
        assert.equal(starts, 0, "A conversation view must not initialize or resume the native runtime.");
        h.developmentOpens.length = 0;
        for (let attempt = 0; attempt < 2; attempt++) {
            const opened = await fetch(new URL("api/development/open", entry.url), {
                method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
            });
            assert.equal(opened.status, 200, await opened.clone().text());
            assert.deepEqual(await opened.json(), { url: "http://127.0.0.1:8765/" });
        }
        assert.equal(JSON.stringify(await h.api.loadState("direct")), JSON.stringify(before));
        assert.deepEqual(h.developmentOpens, ["development-browser", "development-browser"]);
        assert.equal(h.developmentRequests.length, 0);
        assert.equal(starts, 2);
        assert.equal(h.requests.length, 0);
        await assert.rejects(h.api.continueDevelopment("direct", "project:tandem"), /Complete Prototype/);
        assert.equal(h.developmentRequests.length, 0, "Opening directly does not weaken the strict Prototype handoff.");
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close(error => error ? reject(error) : resolve()));
        await h.close();
    }
});

test("synthetic fresh provider opens Development from finished Stage1 files without retaining the Stage1 connection", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-stage-independence-"));
    const first = await extensionHarness({}, root);
    let fresh: Awaited<ReturnType<typeof extensionHarness>> | undefined;
    let entry: Awaited<ReturnType<typeof first.api.startServer>> | undefined;
    try {
        const state = first.api.createState("portable-input", "A command-line tool");
        state.stage = state.lifecycle.currentStage = "requirements";
        state.lifecycle.completedStages = ["prepare"];
        state.preparation.status = "ready";
        state.requirements = { substage: "dag", usageItems: ["Use the command"], suggestions: [] };
        state.decisionGraph.nodes = [{ id: "choice", title: "Command behavior", dependencies: [],
            question: null, answer: "Use the CLI", status: "answered" }];
        state.prototypeApproach = { mode: "not-applicable", reason: "CLI only" };
        await first.api.persistState(state);
        first.setBeforeDevelopmentStart(async () => { throw new Error("No Stage2 connection may exist yet."); });
        const completed = await first.api.completeLifecycleStage(state.prototypeId, "requirements", "project:tandem");
        const files = await retainedFiles(join(root, ".tandem", "efforts"));
        assert.ok(completed.development == null);
        assert.equal(first.developmentRequests.length, 0);
        await assert.rejects(access(join(root, ".tandem", "living-canvas")), { code: "ENOENT" });
        await first.close();

        fresh = await extensionHarness({}, root);
        fresh.api.setSession({ ...fresh.session, sessionId: "fresh-provider-fixture" });
        const loaded = await fresh.api.loadState(state.prototypeId);
        assert.equal(loaded.generation, completed.generation);
        assert.deepEqual(await retainedFiles(join(root, ".tandem", "efforts")), files);
        for (const output of loaded.lifecycle.outputs) {
            const document = JSON.parse(await readFile(join(root, output.path), "utf8"));
            assert.equal(document.result.decisionGraph.nodes[0].answer, "Use the CLI");
        }
        entry = await fresh.api.startServer("later-view", state.prototypeId, "project:tandem", true);
        const opened = await fetch(new URL("api/development/open", entry.url), {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        assert.equal(opened.status, 200, await opened.clone().text());
        assert.equal(fresh.developmentOpens.length, 1);
        assert.equal(fresh.developmentRequests.length, 0, "Files remain optional inputs, not automatic request or implementation authority.");
        assert.equal(fresh.requests.length, 0);
        assert.ok((await fresh.api.loadState(state.prototypeId)).development == null);
        assert.deepEqual(await retainedFiles(join(root, ".tandem", "efforts")), files);
    } finally {
        if (entry) {
            clearInterval(entry.heartbeat); entry.live.close();
            await new Promise<void>((resolve, reject) => entry.server.close(error => error ? reject(error) : resolve()));
        }
        await first.close(); await fresh?.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("direct Development HTTP open still excludes active upstream work and a read-only provider", async () => {
    const h = await extensionHarness();
    const state = h.api.createState("active");
    state.preparation.status = "running";
    await h.api.persistState(state);
    const entry = await h.api.startServer("active", "active", "project:tandem", true);
    try {
        const post = () => fetch(new URL("api/development/open", entry.url), {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        const active = await post();
        assert.notEqual(active.status, 200);
        assert.match(await active.text(), /Finish upstream work/);
        state.preparation.status = "not-started";
        await h.api.persistState(state);
        h.api.setSession({ ...h.session, rpc: { ...h.session.rpc,
            extensions: { list: async () => ({ extensions: [{ id: "user:tandem", status: "running" }] }) } } });
        const readOnly = await post();
        assert.notEqual(readOnly.status, 200);
        assert.match(await readOnly.text(), /writable provider/);
        assert.deepEqual(h.developmentOpens, []);
        assert.equal(h.developmentRequests.length, 0);
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close(error => error ? reject(error) : resolve()));
        await h.close();
    }
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
        await h.api.completeLifecycleStage("race", "requirements", "project:tandem");
        const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
        h.setBeforeDevelopmentStart(async () => { entered.resolve(); await release.promise; });
        const handoff = h.api.continueDevelopment("race", "project:tandem");
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
