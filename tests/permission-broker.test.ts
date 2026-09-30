import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { build } from "esbuild";
import { InMemoryEventStore } from "../stage2/tandem/runtime-src/event-store.js";
import type * as brokerModule from "../stage2/tandem/runtime-src/permissions/permission-broker.js";

for (const attributed of [false, true]) test(`permission broker keeps scoped approve-all behavior with attributed SDK results: ${attributed}`, async () => {
    const bundle = await build({
        entryPoints: [fileURLToPath(new URL("../stage2/tandem/runtime-src/permissions/permission-broker.ts", import.meta.url))],
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
