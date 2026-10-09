import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { MainSessionEffort } from "../src/main-session-effort.js";

async function fixture(t: TestContext) {
    const root = await mkdtemp(join(tmpdir(), "tandem-main-effort-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const state = { model: "main-model" as string | undefined, effort: undefined as string | undefined, busy: false, changes: 0, fail: false };
    const session = { rpc: {
        model: {
            getCurrent: async () => ({ modelId: state.model, reasoningEffort: state.effort }),
            list: async () => ({ list: [{ id: "main-model", capabilities: { supports: { reasoning_effort: ["low", "high"] } } }] }),
            setReasoningEffort: async ({ reasoningEffort }: { reasoningEffort: string }) => {
                state.changes++;
                if (state.fail) throw new Error("SDK write failed");
                state.effort = reasoningEffort;
            },
        },
        metadata: { isProcessing: async () => ({ processing: state.busy }), activity: async () => ({ hasActiveWork: state.busy }) },
    } };
    return { root, state, session, preference: new MainSessionEffort(root, () => session) };
}

test("main effort leaves unset defaults unchanged and restores an explicit choice without changing model", async t => {
    const f = await fixture(t);
    await f.preference.applySaved();
    assert.equal(f.state.changes, 0);
    assert.equal((await f.preference.status()).status, "unset");
    assert.equal((await f.preference.select("low")).status, "applied");
    assert.equal(f.state.model, "main-model");
    f.state.effort = undefined;
    const cold = new MainSessionEffort(f.root, () => f.session);
    await cold.applySaved();
    assert.equal(f.state.effort, "low");
    assert.equal((await cold.status()).desired, "low");
});

test("main effort rejects busy and unsupported choices before persisting or changing anything", async t => {
    const f = await fixture(t);
    f.state.busy = true;
    await assert.rejects(f.preference.select("low"), /idle/);
    f.state.busy = false;
    await assert.rejects(f.preference.select("max"), /does not advertise/);
    await assert.rejects(f.preference.select("invented"), /Invalid/);
    assert.equal(await f.preference.desired(), null);
    assert.equal(f.state.changes, 0);
});

test("main effort retains intent and exposes pending or failed application without fallback", async t => {
    const f = await fixture(t);
    f.state.model = undefined;
    assert.equal((await f.preference.select("low")).status, "pending");
    assert.equal(f.state.changes, 0);
    await assert.rejects(f.preference.assertApplied(), /Apply the selected/);
    f.state.model = "main-model"; f.state.fail = true;
    await assert.rejects(f.preference.select("low"), /SDK write failed/);
    assert.equal(await f.preference.desired(), "low");
    assert.equal((await f.preference.status()).status, "error");
    f.state.fail = false;
    await f.preference.select("low");
    await f.preference.assertApplied();
});

test("corrupt main preference is preserved rather than replaced by defaults", async t => {
    const f = await fixture(t);
    await mkdir(join(f.root, ".tandem", "desktop"), { recursive: true });
    await writeFile(join(f.root, ".tandem", "desktop", "reasoning-effort.json"), '{"schemaVersion":"wrong","desired":"low"}');
    await assert.rejects(f.preference.desired(), /invalid/);
    await assert.rejects(f.preference.select("low"), /invalid/);
});

test("failed or malformed authoritative readback never becomes an unset or applied preference", async t => {
    const f = await fixture(t);
    for (const model of ["", " main-model"]) {
        f.state.model = model;
        await assert.rejects(f.preference.select("low"), /readback is invalid/);
        assert.equal(await f.preference.desired(), null);
    }
    f.state.model = "main-model"; f.state.effort = "invalid";
    assert.equal((await f.preference.status()).status, "error");
    f.state.effort = "medium";
    await f.preference.select("low");
    assert.equal(f.state.effort, "low");
    f.session.rpc.model.getCurrent = async () => { throw new Error("SDK read failed"); };
    await assert.rejects(f.preference.applySaved(), /SDK read failed/);
    await assert.rejects(f.preference.assertApplied(), /SDK read failed/);
    assert.equal((await f.preference.status()).status, "error");
    assert.equal(await f.preference.desired(), "low");
    assert.equal(f.state.changes, 1);
});
