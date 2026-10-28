import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CopilotClient, RuntimeConnection, type SessionConfig } from "@github/copilot-sdk";
import { createDurablePrivateSession } from "../development/tandem/src/human-loop-controller.mjs";
import { desktopRuntimeEnvironment } from "../src/desktop/environment.js";

test("actual unused private session survives clean shutdown and cold same-ID reopen without a model turn",
    { skip: process.env.TANDEM_NATIVE_DURABILITY !== "1", timeout: 180_000 }, async t => {
        const workspace = await mkdtemp(join(tmpdir(), "tandem-native-durability-"));
        t.after(() => rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
        const sessionId = randomUUID();
        const makeClient = () => new CopilotClient({
            connection: RuntimeConnection.forStdio(), workingDirectory: workspace,
            env: desktopRuntimeEnvironment(), logLevel: "none",
        });
        const configuration: SessionConfig = {
            sessionId, workingDirectory: workspace, requestExtensions: false,
            enableConfigDiscovery: false, tools: [], availableTools: [],
            excludedTools: ["builtin:*", "mcp:*", "custom:*"], mcpServers: {}, customAgents: [],
            onPermissionRequest: () => ({ kind: "denied-no-approval-rule-and-could-not-request-from-user" }),
        };
        const client = makeClient();
        let initialEventIds: string[] = [];
        try {
            const session = await createDurablePrivateSession(client, configuration);
            assert.equal(session.sessionId, sessionId);
            assert.equal((await session.rpc.name.get()).name, "Tandem Development");
            const events = await session.getEvents();
            initialEventIds = events.map(event => event.id);
            assert.ok(!events.some(event => ["user.message", "assistant.usage", "tool.execution_start", "subagent.started"].includes(event.type)));
            t.diagnostic(JSON.stringify({ sessionId, created: true, named: true,
                metadataBeforeClose: Boolean(await client.getSessionMetadata(sessionId)),
                storageBytesBeforeClose: (await client.rpc.sessions.getSizes()).sizes[sessionId] ?? null }));
        } finally {
            t.diagnostic("Closing the original native client before cold inspection.");
            const errors = await client.stop();
            assert.deepEqual(errors, [], "The original native client must close cleanly.");
            t.diagnostic("Original native client closed.");
        }
        const observer = makeClient();
        try {
            t.diagnostic("Starting the read-only cold inspector.");
            await observer.start();
            const metadata = await observer.getSessionMetadata(sessionId);
            const bytes = (await observer.rpc.sessions.getSizes()).sizes[sessionId];
            t.diagnostic(JSON.stringify({ sessionId, metadataAfterClose: Boolean(metadata), storageBytesAfterClose: bytes ?? null }));
            assert.equal(metadata?.sessionId, sessionId, "Named/saved private creation must retain the original native identity.");
            assert.equal(metadata.isRemote, false);
            assert.ok(typeof bytes === "number" && bytes > 0, "Cold resume needs actual native storage, not save RPC success.");
            const session = await observer.resumeSession(sessionId, {
                ...configuration, continuePendingWork: false, suppressResumeEvent: true,
            });
            assert.equal(session.sessionId, sessionId);
            const events = await session.getEvents();
            assert.ok(initialEventIds.every(id => events.some(event => event.id === id)), "Cold resume must preserve the original native events.");
            assert.ok(!events.some(event => ["user.message", "assistant.usage", "tool.execution_start", "subagent.started"].includes(event.type)));
        } finally {
            assert.deepEqual(await observer.stop(), [], "The exact-ID observer must close cleanly.");
        }
    });
