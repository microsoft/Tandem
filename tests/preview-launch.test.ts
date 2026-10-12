import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, type TestContext } from "node:test";
import { PreviewLaunches } from "../src/preview-launch.js";
import { fingerprintPrototypeWorkspace } from "../src/prototype-runtime.js";
import { writeJsonAtomically } from "../src/project-store.js";
import { state, checkpoint } from "./renderer-fixtures.test.js";

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
    const operations: Array<{ name: string; arguments: Record<string, string | boolean> }> = [];
    const launches = new PreviewLaunches({
        root, storageRoot: join(root, ".tandem"), mainSessionId: () => owner, executable: process.execPath, launcher,
        readState: async () => value, guard: async () => {},
        verifyIdentity: async () => {
            if (identityMismatch) throw Object.assign(new Error("Different checkpoint identity"), { code: "preview_checkpoint_mismatch" });
            if (!running) throw Object.assign(new Error("Not reachable"), { code: "preview_unreachable" });
        },
        tools: { async execute(input) {
            operations.push(input);
            if (input.name === "stop_powershell") return { resultType: "success" };
            if (denied) return { resultType: "rejected", error: "User rejected the native request." };
            const args = [...String(input.arguments.command).matchAll(/'([^']*)'/g)].map(match => match[1]!);
            const manifest = JSON.parse(await readFile(args[2]!, "utf8"));
            if (drift) owner = "different-main";
            running = true;
            await writeJsonAtomically(join(args[2]!, "..", "process.json"), { status: "running", launchId: manifest.launchId });
            return { resultType: "success" };
        } },
    });
    return { value, launches, operations, root, setRunning: () => { running = true; }, deny: () => { denied = true; },
        drift: () => { drift = true; }, mismatch: () => { identityMismatch = true; }, owner: () => { owner = "other-main"; } };
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
