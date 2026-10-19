import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, type TestContext } from "node:test";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { PreviewLaunches } from "../src/preview-launch.js";
import { fingerprintPrototypeWorkspace } from "../src/prototype-runtime.js";
import { writeJsonAtomically } from "../src/project-store.js";
import { state, checkpoint } from "./renderer-fixtures.test.js";
import { visualManifest } from "./helpers/visual-fixture.js";
import { discoverPreviewStarts, readPreviewStart, verifyPreviewStart } from "../src/preview-start.js";

async function freePort() {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    await new Promise<void>(resolve => server.close(() => resolve()));
    return address.port;
}
async function fixture(t: TestContext) {
    const root = await mkdtemp(join(tmpdir(), "tandem-preview-launch-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const value = state("prototype");
    value.prototypeId = "fixture";
    const launcher = join(root, "launcher.mjs"); await writeFile(launcher, "// trusted fixture");
    const checkpoints = [];
    for (const id of ["current", "pending"]) {
        const directory = join(root, ".tandem", "efforts", "fixture", "previews", id);
        await mkdir(directory, { recursive: true }); await writeFile(join(directory, "server.mjs"), "// saved source");
        checkpoints.push(checkpoint(id, id === "current" ? "structure" : "interaction", "ready", {
            requestId: id, workspacePath: directory, workspacePrepared: true, generation: value.generation,
            sourceFingerprint: await fingerprintPrototypeWorkspace(directory), previewUrl: `http://127.0.0.1:${await freePort()}/`,
        }));
    }
    value.prototypeFlow = { version: 1, checkpoints, displayedCheckpointId: "current", pendingCheckpointId: "pending",
        activeCheckpointId: null, visualRequested: false, budget: { limitSeconds: null, usedSeconds: 0 } };
    let owner = "main", running = false, denied = false, drift = false, identityMismatch = false;
    let busy = false, busyAfterLaunch = false, failedAfterLaunch = false, stopFails = false, guardCalls = 0, stateReads = 0;
    const operations: Array<{ name: string; arguments: Record<string, string | boolean> }> = [];
    const launches = new PreviewLaunches({
        root, storageRoot: join(root, ".tandem"), mainSessionId: () => owner, executable: process.execPath, launcher,
        readState: async () => { stateReads++; return value; },
        guard: async () => {
            guardCalls++;
            if (busy) throw new Error("The owning session has unrelated foreground work.");
        },
        verifyIdentity: async () => {
            if (identityMismatch) throw Object.assign(new Error("Different checkpoint identity"), { code: "preview_checkpoint_mismatch" });
            if (!running) throw Object.assign(new Error("Not reachable"), { code: "preview_unreachable" });
        },
        tools: { async execute(input) {
            operations.push(input);
            if (input.name === "stop_powershell") return stopFails
                ? { resultType: "failure", error: "Native shutdown is unconfirmed." } : { resultType: "success" };
            if (denied) return { resultType: "rejected", error: "User rejected the native request." };
            const args = [...String(input.arguments.command).matchAll(/'([^']*)'/g)].map(match => match[1]!);
            const manifest = JSON.parse(await readFile(args[2]!, "utf8"));
            if (drift) owner = "different-main";
            busy = busyAfterLaunch;
            running = !failedAfterLaunch;
            await writeJsonAtomically(join(args[2]!, "..", "process.json"), {
                status: failedAfterLaunch ? "exited" : "running", launchId: manifest.launchId,
                ...(failedAfterLaunch ? { error: "Exit 1: listen EADDRINUSE at the server's default port." } : {}),
            });
            return { resultType: "success" };
        } },
    });
    return { value, launches, operations, root, setRunning: () => { running = true; }, deny: () => { denied = true; },
        drift: () => { drift = true; }, mismatch: () => { identityMismatch = true; }, owner: () => { owner = "other-main"; },
        setBusy(value: boolean) { busy = value; },
        setStopFailure(value: boolean) { stopFails = value; },
        notifyOnLaunch(failed = false) { busyAfterLaunch = true; failedAfterLaunch = failed; },
        guardCalls: () => guardCalls, stateReads: () => stateReads };
}
test("saved current and pending preview launch requires reviewed data and explicit native approval without promotion", async t => {
    const f = await fixture(t), before = structuredClone(f.value);
    const missing = await f.launches.inspect(f.value, "current");
    assert.equal(missing.needsRecipe, true);
    assert.equal(f.operations.length, 0);
    const proposal = await f.launches.inspect(f.value, "pending", "server.mjs");
    assert.equal(proposal.checkpointId, "pending");
    assert.ok(proposal.confirmationId);
    const results = await Promise.all([f.launches.decide(proposal.confirmationId, true), f.launches.decide(proposal.confirmationId, true)]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(f.operations.filter(item => item.name === "powershell").length, 1);
    assert.deepEqual(f.value, before);
    await f.launches.close();
    assert.equal(f.operations.filter(item => item.name === "stop_powershell").length, 1);
});
test("cancel and already-live preview never launch duplicate servers", async t => {
    const f = await fixture(t);
    const cancel = await f.launches.inspect(f.value, "current", "server.mjs");
    await f.launches.decide(cancel.confirmationId!, false);
    assert.equal(f.operations.length, 0);
    const proposal = await f.launches.inspect(f.value, "current", "server.mjs");
    f.setRunning();
    const result = await f.launches.decide(proposal.confirmationId!, true);
    assert.equal((result as { alreadyRunning: boolean }).alreadyRunning, true);
    assert.equal(f.operations.length, 0);
});

test("preview launch checks foreground admission before dispatch but not during its own readiness observation", async t => {
    const f = await fixture(t), before = structuredClone(f.value);
    const proposal = await f.launches.inspect(f.value, "current", "server.mjs");
    const checksBefore = f.guardCalls();
    f.notifyOnLaunch();
    const result = await f.launches.decide(proposal.confirmationId!, true) as { started: boolean };
    assert.equal(result.started, true);
    assert.equal(f.guardCalls(), checksBefore + 1, "session-wide busy is admission, not a post-launch readiness gate");
    assert.ok(f.stateReads() >= 3, "ownership and saved selection remain checked after dispatch");
    assert.deepEqual(f.value, before);
    assert.equal(f.operations.filter(item => item.name === "stop_powershell").length, 0);
    await f.launches.close();
});

test("a failed launch reports its own process error even when its completion notification wakes native processing", async t => {
    const f = await fixture(t);
    const proposal = await f.launches.inspect(f.value, "current", "server.mjs");
    f.notifyOnLaunch(true);
    await assert.rejects(f.launches.decide(proposal.confirmationId!, true), /did not remain running.*EADDRINUSE/);
    assert.equal(f.operations.filter(item => item.name === "powershell").length, 1);
    assert.equal(f.operations.at(-1)!.name, "stop_powershell");
});

test("failed native cleanup cannot hide the original startup error", async t => {
    const f = await fixture(t);
    const proposal = await f.launches.inspect(f.value, "current", "server.mjs");
    f.notifyOnLaunch(true); f.setStopFailure(true);
    await assert.rejects(f.launches.decide(proposal.confirmationId!, true),
        /EADDRINUSE.*Owned preview shutdown also failed.*unconfirmed/);
    f.setStopFailure(false);
    await f.launches.close();
});

test("unrelated foreground work arriving after confirmation still blocks native preview launch", async t => {
    const f = await fixture(t);
    const proposal = await f.launches.inspect(f.value, "current", "server.mjs");
    f.setBusy(true);
    await assert.rejects(f.launches.decide(proposal.confirmationId!, true), /unrelated foreground work/);
    assert.equal(f.operations.length, 0);
    await f.launches.decide(proposal.confirmationId!, false);
    f.setBusy(false);
    const retry = await f.launches.inspect(f.value, "current");
    assert.equal(retry.needsRecipe, true, "blocked admission did not save a launch record");
});
test("visual exploration restart binds only its source and preserves the current choice and comparison settings", async t => {
    const f = await fixture(t);
    const manifest = visualManifest();
    f.value.prototypeFlow.pendingCheckpointId = null;
    const exploration = f.value.prototypeFlow.checkpoints[1];
    exploration.milestone = "visual";
    exploration.visual = { operation: "explore", explorationCheckpointId: null, selection: null, manifest };
    f.value.prototypeFlow.visualExploration = { checkpointId: exploration.id, activeDirectionId: "canvas", appliedCheckpointId: null,
        selections: manifest.directions.map(direction => ({ directionId: direction.id, settings: direction.defaults })) };
    const before = structuredClone(f.value);
    const proposal = await f.launches.inspect(f.value, "exploration", "server.mjs");
    assert.equal(proposal.checkpointId, exploration.id);
    assert.equal(proposal.url, exploration.previewUrl);
    assert.equal(proposal.target, "exploration");
    assert.equal(f.operations.length, 0);
    await f.launches.decide(proposal.confirmationId!, true);
    assert.deepEqual(f.value, before);
    assert.equal(f.operations.filter(item => item.name === "powershell").length, 1);
    await f.launches.close();
});
for (const failure of ["source", "owner", "permission", "identity", "during-launch-owner"]) test(`saved preview refuses ${failure} changes and preserves checkpoints`, async t => {
    const f = await fixture(t), before = structuredClone(f.value);
    const proposal = await f.launches.inspect(f.value, "current", "server.mjs");
    if (failure === "source") await writeFile(join(f.value.prototypeFlow.checkpoints[0].workspacePath, "server.mjs"), "changed");
    if (failure === "owner") f.owner();
    if (failure === "permission") f.deny();
    if (failure === "identity") f.mismatch();
    if (failure === "during-launch-owner") f.drift();
    await assert.rejects(f.launches.decide(proposal.confirmationId!, true));
    assert.deepEqual(f.value, before);
    assert.equal(f.operations.filter(item => item.name === "powershell").length, ["permission", "during-launch-owner"].includes(failure) ? 1 : 0);
    if (f.operations.length) assert.equal(f.operations.at(-1)!.name, "stop_powershell");
    await f.launches.decide(proposal.confirmationId!, false);
});
test("a recorded recipe is reused only under its original owner and never supplies a guessed script", async t => {
    const f = await fixture(t);
    const inspect = await f.launches.inspect(f.value, "current");
    assert.equal(inspect.needsRecipe, true);
    assert.deepEqual(inspect.entrypoints, ["server.mjs"]);
    const proposal = await f.launches.inspect(f.value, "current", "server.mjs");
    await f.launches.decide(proposal.confirmationId!, true);
    const recorded = await f.launches.inspect(f.value, "current");
    assert.equal(recorded.needsRecipe, false);
    assert.deepEqual(recorded.args, proposal.args);
    f.owner();
    await assert.rejects(f.launches.inspect(f.value, "current", "server.mjs"), /different ownership/);
    await f.launches.close();
});
test("unsafe launch entrypoints never reach native execution", async t => {
    const f = await fixture(t);
    for (const entrypoint of ["../escape.mjs", "-e", "server.cmd", process.execPath]) {
        await assert.rejects(f.launches.inspect(f.value, "current", entrypoint));
    }
    assert.equal(f.operations.length, 0);
});
test("an unrelated listener on the saved port is never replaced or adopted", async t => {
    const f = await fixture(t);
    const server = createServer();
    await new Promise<void>(resolve => server.listen(Number(new URL(f.value.prototypeFlow.checkpoints[0].previewUrl).port), "127.0.0.1", resolve));
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
    const proposal = await f.launches.inspect(f.value, "current", "server.mjs");
    await assert.rejects(f.launches.decide(proposal.confirmationId!, true), /occupied/);
    assert.equal(f.operations.length, 0);
});

test("new checkpoints reuse their saved start instructions without asking for a server file", async t => {
    const f = await fixture(t), saved = f.value.prototypeFlow.checkpoints[0];
    await mkdir(join(saved.workspacePath, "app"));
    await writeFile(join(saved.workspacePath, "app", "server.mjs"), "// saved nested server");
    saved.previewStart = { entrypoint: join("app", "server.mjs"), workingDirectory: "app", args: ["--port", new URL(saved.previewUrl).port, "a value with spaces"] };
    saved.sourceFingerprint = await fingerprintPrototypeWorkspace(saved.workspacePath);
    const before = structuredClone(f.value);
    const proposal = await f.launches.inspect(f.value, "current");
    assert.equal(proposal.needsRecipe, false);
    assert.equal(proposal.workingDirectory, join(saved.workspacePath, "app"));
    assert.deepEqual(proposal.args, [join(saved.workspacePath, "app", "server.mjs"), ...saved.previewStart.args]);
    assert.match(proposal.message, /do not need to choose a file/);
    assert.equal(f.operations.length, 0, "finding start instructions does not start or approve anything");
    await f.launches.decide(proposal.confirmationId!, true);
    assert.deepEqual(f.value, before);
    const persisted = await f.launches.inspect(f.value, "current");
    assert.deepEqual(persisted.args, proposal.args);
    await f.launches.close();
});

test("older previews discover nested package start options without guessing shell syntax or replacing arguments", async t => {
    const f = await fixture(t), saved = f.value.prototypeFlow.checkpoints[0], root = saved.workspacePath;
    await mkdir(join(root, "app"));
    await writeFile(join(root, "app", "server.mjs"), "// existing server");
    await writeFile(join(root, "app", "client.js"), "// not a server");
    await writeFile(join(root, "app", "tandem-preview-bridge.js"), "// host bridge");
    await writeFile(join(root, "app", "package.json"), JSON.stringify({ scripts: {
        dev: 'node "./server.mjs" --port 4321 --title "Robot simulation"',
        build: "node client.js", start: "node server.mjs && echo done", preview: "vite preview",
    } }));
    saved.sourceFingerprint = await fingerprintPrototypeWorkspace(root);
    const discovery = await f.launches.inspect(f.value, "current");
    assert.equal(discovery.needsRecipe, true);
    const choice = discovery.choices!.find(item => item.source === "package-script")!;
    assert.equal(choice.entrypoint, join("app", "server.mjs"));
    assert.equal(choice.workingDirectory, "app");
    assert.deepEqual(choice.args, ["--port", "4321", "--title", "Robot simulation"]);
    assert.equal(discovery.choices!.filter(item => item.entrypoint === choice.entrypoint).length, 1);
    assert.equal(discovery.choices!.some(item => item.entrypoint.endsWith("client.js")), false);
    assert.equal(discovery.entrypoints!.some(item => item.endsWith("tandem-preview-bridge.js")), false);
    assert.equal(discovery.notices!.length, 2, "unsupported launches are explained rather than substituted");
    const proposal = await f.launches.inspect(f.value, "current", undefined, undefined, undefined, choice.id);
    assert.equal(proposal.needsRecipe, false);
    assert.deepEqual(proposal.args, [join(root, "app", "server.mjs"), ...choice.args]);
    assert.equal(proposal.workingDirectory, join(root, "app"));
    assert.equal(f.operations.length, 0);
    await assert.rejects(f.launches.inspect(f.value, "pending", undefined, undefined, undefined, choice.id), /start option changed/);
    await assert.rejects(f.launches.inspect(f.value, "current", "server.mjs", [], ".", choice.id), /not both/);
});

test("preview start discovery does not follow dependency or external links and keeps unknown files in Advanced only", async t => {
    const f = await fixture(t), root = f.value.prototypeFlow.checkpoints[0].workspacePath;
    const outside = join(f.root, "unrelated"); await mkdir(outside);
    await writeFile(join(outside, "server.mjs"), "// never a candidate");
    await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "server.js"), "// dependency");
    await writeFile(join(root, "main.js"), "// browser entry");
    const discovery = await discoverPreviewStarts(root);
    assert.deepEqual(discovery.choices.map(item => item.entrypoint), ["server.mjs"]);
    assert.deepEqual(discovery.entrypoints, ["main.js", "server.mjs"]);
    await assert.rejects(verifyPreviewStart(root, { entrypoint: join("linked", "server.mjs"), workingDirectory: ".", args: [] }), /aliased|unsafe/);
    for (const command of ["node --eval 'process.exit()'", "node server.mjs | echo done", "PORT=4321 node server.mjs",
        'node server.mjs --name="two words"', "node server.mjs 'two words'", 'node server.mjs --name a^b',
        'node server.mjs --name "trailing\\"']) {
        await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { dev: command } }));
        assert.equal((await discoverPreviewStarts(root)).choices.some(item => item.source === "package-script"), false);
    }
    assert.throws(() => readPreviewStart({ entrypoint: "server.mjs", workingDirectory: "..", args: [] }), /saved preview/);
    assert.throws(() => readPreviewStart({ entrypoint: "index.html", workingDirectory: ".", args: [] }), /Node server file/);
    assert.throws(() => readPreviewStart({ entrypoint: "server.mjs", workingDirectory: ".", args: "[]" }), /argument list/);
});

test("a rejected or changed detected launch is never silently replaced by another option", async t => {
    const f = await fixture(t), root = f.value.prototypeFlow.checkpoints[0].workspacePath;
    const discovery = await f.launches.inspect(f.value, "current");
    const selected = discovery.choices![0]!;
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { start: "node server.mjs --different" } }));
    await assert.rejects(f.launches.inspect(f.value, "current", undefined, undefined, undefined, selected.id), /start option changed/);
    assert.equal(f.operations.length, 0);
    await assert.rejects(f.launches.inspect(f.value, "current", "server.mjs", [], "../"), /saved preview/);
});

for (const portSource of ["argument", "environment", "startup-error"] as const) test(`Windows preview restart handles ${portSource} with the saved port and original process diagnostics`,
    { skip: process.platform !== "win32", timeout: 45_000 }, async () => {
        const root = await mkdtemp(join(tmpdir(), "tandem-restart-native-"));
        const checkpointRoot = join(root, ".tandem", "efforts", "fixture", "previews", "current");
        const app = join(checkpointRoot, "app");
        await mkdir(app, { recursive: true });
        const defaultListener = createServer();
        await new Promise<void>(resolve => defaultListener.listen(0, "127.0.0.1", resolve));
        const defaultAddress = defaultListener.address(); assert.ok(defaultAddress && typeof defaultAddress !== "string");
        const port = await freePort(), defaultPort = defaultAddress.port;
        await writeFile(join(app, "preview-data.json"), JSON.stringify({ title: "Saved preview only" }));
        await writeFile(join(app, "server.mjs"), [
            'import { createServer } from "node:http";',
            'import { readFileSync } from "node:fs";',
            'const data = JSON.parse(readFileSync("preview-data.json", "utf8"));',
            'createServer((req, res) => { res.setHeader("Content-Type", "text/html");',
            'res.end(`<meta name="tandem-prototype-id" content="fixture"><meta name="tandem-prototype-checkpoint" content="current"><p>${data.title}</p>`);',
            `}).listen(Number(${portSource === "argument" ? "process.argv[2]"
                : portSource === "environment" ? `process.env.PORT || ${defaultPort}` : defaultPort}), "127.0.0.1");`,
        ].join("\n"));
        const value = state("prototype"), url = `http://127.0.0.1:${port}/`;
        const saved = checkpoint("current", "interaction", "ready", {
            requestId: "current", workspacePath: checkpointRoot, generation: value.generation, previewUrl: url,
            sourceFingerprint: await fingerprintPrototypeWorkspace(checkpointRoot),
            previewStart: { entrypoint: "app\\server.mjs", workingDirectory: "app", args: portSource === "argument" ? [String(port)] : [] },
        });
        value.prototypeId = "fixture";
        value.prototypeFlow = { version: 1, checkpoints: [saved], displayedCheckpointId: "current",
            activeCheckpointId: null, pendingCheckpointId: null, visualRequested: false, budget: { limitSeconds: null, usedSeconds: 0 } };
        const launcher = fileURLToPath(new URL("../src/preview-launcher.ts", import.meta.url));
        let child: ChildProcess | undefined, stderr = "", foregroundBusy = false;
        const stop = async () => {
            if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
            await promisify(execFile)("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
            if (child.exitCode === null && child.signalCode === null) await new Promise<void>(done => child!.once("exit", () => done()));
        };
        const launches = new PreviewLaunches({
            root, storageRoot: join(root, ".tandem"), mainSessionId: () => "fixture-owner", executable: process.execPath, launcher,
            readState: async () => value, guard: async () => {
                if (foregroundBusy) throw new Error("Native background completion is being processed.");
            },
            verifyIdentity: async address => {
                let response: Response;
                try { response = await fetch(address, { signal: AbortSignal.timeout(1500) }); }
                catch (error) { throw Object.assign(new Error(`Preview unavailable: ${String(error)}`), { code: "preview_unreachable" }); }
                const html = await response.text();
                assert.ok(response.ok);
                assert.match(html, /tandem-prototype-checkpoint" content="current"/);
                assert.match(html, /Saved preview only/);
            },
            tools: { execute: async input => {
                if (input.name === "stop_powershell") { await stop(); return { resultType: "success" }; }
                const parts = [...String(input.arguments.command).matchAll(/'((?:''|[^'])*)'/g)].map(match => match[1]!.replaceAll("''", "'"));
                child = spawn(process.execPath, ["--import", "tsx", launcher, parts[2]!, parts[3]!],
                    { cwd: process.cwd(), env: { ...process.env, PORT: String(defaultPort) },
                        stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
                child.stderr!.on("data", data => { stderr += String(data); });
                await new Promise<void>((done, reject) => { child!.once("spawn", done); child!.once("error", reject); });
                foregroundBusy = true;
                return { resultType: "success" };
            } },
        });
        try {
            const proposal = await launches.inspect(value, "current");
            assert.equal(proposal.needsRecipe, false);
            assert.deepEqual(proposal.environment, { PORT: String(port) });
            if (portSource === "startup-error") {
                await assert.rejects(launches.decide(proposal.confirmationId!, true), /did not remain running[\s\S]*EADDRINUSE/);
            } else {
                const result = await launches.decide(proposal.confirmationId!, true) as { started: boolean };
                assert.equal(result.started, true, stderr);
            }
            assert.equal(await fingerprintPrototypeWorkspace(checkpointRoot), saved.sourceFingerprint);
            assert.equal(value.prototypeFlow.displayedCheckpointId, "current");
            assert.equal(defaultListener.listening, true, "the unrelated listener was never replaced or stopped");
        } finally {
            try { await launches.close(); } finally {
                await stop();
                await new Promise<void>(resolve => defaultListener.close(() => resolve()));
                await rm(root, { recursive: true, force: true });
            }
        }
    });
