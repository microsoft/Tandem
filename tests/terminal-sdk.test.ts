import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";

test("the packaged SDK preserves native terminal declarations on create and same-ID resume", async t => {
    const requests: Array<{ method: string; params: {
        tools?: Array<{ isTerminal?: boolean }>; toolSearch?: unknown;
    } }> = [];
    const server = createServer(socket => {
        let pending = Buffer.alloc(0);
        socket.on("data", bytes => {
            pending = Buffer.concat([pending, bytes]);
            for (;;) {
                const header = pending.indexOf("\r\n\r\n");
                if (header < 0) return;
                const length = Number(/Content-Length: (\d+)/i.exec(pending.subarray(0, header).toString())?.[1]);
                assert.ok(Number.isSafeInteger(length));
                if (pending.length < header + 4 + length) return;
                const message = JSON.parse(pending.subarray(header + 4, header + 4 + length).toString());
                pending = pending.subarray(header + 4 + length);
                if (message.id === undefined) continue;
                requests.push(message);
                const result = message.method === "connect" ? { protocolVersion: 3 }
                    : ["session.create", "session.resume"].includes(message.method) ? { sessionId: message.params.sessionId }
                        : {};
                const response = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
                socket.write(`Content-Length: ${Buffer.byteLength(response)}\r\n\r\n${response}`);
            }
        });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const client = new CopilotClient({ connection: RuntimeConnection.forUri(`http://127.0.0.1:${address.port}`) });
    t.after(async () => {
        await client.stop();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });
    const configuration = {
        sessionId: "terminal-contract-fixture", requestExtensions: false, toolSearch: { enabled: false },
        tools: [
            { name: "submit_human_route", isTerminal: true, parameters: { type: "object" }, handler: async () => "saved" },
            { name: "read_current_design", parameters: { type: "object" }, handler: async () => "read" },
        ],
    };
    await client.createSession(configuration);
    await client.resumeSession(configuration.sessionId, { ...configuration, continuePendingWork: false, suppressResumeEvent: true });
    for (const method of ["session.create", "session.resume"]) {
        const request = requests.find(request => request.method === method);
        assert.ok(request);
        assert.equal(request.params.tools?.[0]?.isTerminal, true, `${method} must not drop native turn termination.`);
        assert.equal(request.params.tools?.[1]?.isTerminal, undefined);
        assert.deepEqual(request.params.toolSearch, { enabled: false });
    }
    assert.equal(requests.filter(request => request.method === "session.send").length, 0);
});
