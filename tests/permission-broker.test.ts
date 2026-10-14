import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { build } from "esbuild";
import { InMemoryEventStore } from "../development/tandem/runtime-src/event-store.js";
import type * as brokerModule from "../development/tandem/runtime-src/permissions/permission-broker.js";
import { PermissionBroker } from "../development/tandem/runtime-src/permissions/permission-broker.js";

test("current workflow consent remains scoped and environment access requires its own one-time decision", async () => {
    const broker = new PermissionBroker(new InMemoryEventStore());
    const pending = broker.request({
        kind: "workflow", name: "qualification", description: "No model work.", operation: "run", approvalKey: "exact-workflow",
    }, { sessionId: "owner" });
    const workflow = broker.list()[0]!;
    assert.match(workflow.title, /workflow qualification/);
    await broker.decide(workflow.id, "session");
    assert.deepEqual(await pending, { kind: "approve-for-session", approval: { kind: "workflow", approvalKey: "exact-workflow" } });
    const environment = broker.request({
        kind: "extension-env-access", extensionName: "owned-extension", environmentVariables: ["EXAMPLE_SECRET_NAME"],
    }, { sessionId: "owner" });
    const prompt = broker.list()[0]!;
    assert.equal(prompt.canApproveAll, false);
    assert.equal(prompt.canApproveForSession, false);
    assert.deepEqual(prompt.scopes, ["extension environment access", "owned-extension", "EXAMPLE_SECRET_NAME"]);
    await broker.decide(prompt.id, "once");
    assert.equal((await environment).kind, "approve-once");
});

for (const attributed of [false, true]) test(`permission broker keeps scoped approve-all behavior with attributed SDK results: ${attributed}`, async () => {
    const bundle = await build({
        entryPoints: [fileURLToPath(new URL("../development/tandem/runtime-src/permissions/permission-broker.ts", import.meta.url))],
        bundle: true, write: false, platform: "node", format: "cjs", logLevel: "silent",
        plugins: [{
            name: "sdk-permission-result-fixture",
            setup(api) {
                api.onResolve({ filter: /^@github\/copilot-sdk$/ }, () => ({ path: "permissions", namespace: "fixture" }));
                api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
                    contents: `export const approveAll = async (_request, invocation) => {
                        const result = {kind: invocation.managedSettingsEnabled ? "no-result" : "approve-once"};
                        return ${attributed ? '{kind: "attributed", result, decisionContext: {source: "fixture"}}' : "result"};
                    };`,
                }));
            },
        }],
    });
    const module = { exports: {} };
    runInNewContext(bundle.outputFiles[0]!.text, { module, exports: module.exports, require: createRequire(import.meta.url) });
    const { PermissionBroker } = module.exports as typeof brokerModule;
    const events = new InMemoryEventStore(), broker = new PermissionBroker(events);
    const request = { kind: "read" as const, path: "fixture.txt", intention: "Inspect the owned fixture." };
    const first = broker.request(request, { sessionId: "owned" });
    const queued = broker.request(request, { sessionId: "owned" });
    const foreign = broker.request(request, { sessionId: "another" });
    const grantId = broker.list()[0]!.id;
    await broker.decide(grantId, "all");
    assert.equal((await first).kind, "approve-once");
    assert.equal((await queued).kind, "approve-once", "Queued decisions unwrap the SDK result.");
    assert.equal((await broker.request(request, { sessionId: "owned" })).kind, "approve-once", "Future decisions also unwrap it.");
    assert.equal(broker.list().length, 1, "Another session does not inherit the grant.");
    await broker.decide(broker.list()[0]!.id, "denied");
    assert.equal((await foreign).kind, "reject");
    const managed = broker.request(request, { sessionId: "owned", managedSettingsEnabled: true });
    assert.equal(broker.list()[0]!.canApproveAll, false);
    await broker.decide(broker.list()[0]!.id, "denied");
    assert.equal((await managed).kind, "reject");
    const stale = broker.request(request, { sessionId: "owned" });
    broker.resetSession("owned");
    assert.equal((await stale).kind, "reject", "An in-flight automatic approval cannot cross reset.");
    assert.equal(broker.list().length, 0);
});
