import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import type { HostSnapshot } from "../src/browser/contracts.js";
import { createBrowserHost } from "../src/browser/server.js";
import { desktopRuntimeEnvironment } from "../src/desktop/environment.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = await mkdtemp(join(tmpdir(), "tandem-browser-smoke-"));
const sessions = new Set<string>();
const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };

async function cycle(): Promise<{ sessionId: string; generation: string }> {
    const host = await createBrowserHost({
        version: metadata.version, runtimeDirectory: join(root, "dist", "browser"), workspace, initialDirectory: workspace,
        preferencesPath: join(workspace, "host-preferences"), page: "<html>Tandem startup smoke</html>", scriptHash: "sha256-smoke",
    });
    let current: HostSnapshot | undefined;
    const request = async (path: string, body?: unknown) => {
        const response = await fetch(new URL(path, host.url), {
            method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${host.capability}`,
                Origin: new URL(host.url).origin, ...(body ? { "Content-Type": "application/json" } : {}) },
            body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000),
        });
        assert.ok(response.ok, `${path}: HTTP ${response.status}: ${await response.clone().text()}`);
        return response;
    };
    try {
        host.start();
        const page = await fetch(host.url).then((response) => response.text());
        assert.ok(!page.includes(host.capability));
        const deadline = Date.now() + 60_000;
        for (;;) {
            current = await request("host/state").then((response) => response.json()) as HostSnapshot;
            if (current.sessionId) sessions.add(current.sessionId);
            if (current.phase === "error") throw new Error(current.error || "Browser startup failed.");
            for (const prompt of current.requests) {
                assert.equal(prompt.type, "permission", "empty startup must not ask an agent question");
                if (prompt.type !== "permission") throw new Error("Unexpected question.");
                const details = JSON.parse(prompt.details) as { kind: string; extensionName?: string };
                assert.ok(prompt.canAllowAllForSession && ["extension-management", "extension-permission-access"].includes(details.kind)
                    && details.extensionName && /(?:^|:)tandem$/i.test(details.extensionName),
                "only individual Tandem extension-startup consent is permitted; never approve AI work");
                await request("host/command", { type: "permission-response", id: prompt.id, approved: true, generation: current.generation });
            }
            if (current.phase === "ready") break;
            if (Date.now() > deadline) throw new Error("Browser startup did not finish.");
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal(current.permissionMode, "ask");
        assert.ok(current.sessionId && current.canvasUrl);
        const application = await fetch(new URL("api/state", current.canvasUrl)).then((response) => response.json()) as {
            goal: string; generation: string; factoryRuns?: unknown[]; provider: { canSubmitAnswers: boolean };
        };
        assert.equal(application.goal, "");
        assert.equal(application.provider.canSubmitAnswers, true);
        assert.equal(application.factoryRuns?.length || 0, 0);
        return { sessionId: current.sessionId, generation: application.generation };
    } finally {
        await host.close();
        await host.finished;
        if (current?.canvasUrl) await assert.rejects(fetch(current.canvasUrl, { signal: AbortSignal.timeout(2000) }));
    }
}

try {
    const first = await cycle();
    const second = await cycle();
    assert.equal(first.sessionId, second.sessionId);
    assert.equal(first.generation, second.generation);
    console.info("Standalone browser startup, permission UI transport, writable application, session recovery and shutdown passed. No AI workers were started.");
} finally {
    const identities = join(workspace, ".tandem", "desktop");
    const entries = await readdir(identities, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
    });
    for (const entry of entries.filter((entry) => entry.isDirectory() && /^[a-f0-9]{24}$/.test(entry.name))) {
        const text = await readFile(join(identities, entry.name, "session.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
        });
        if (text === undefined) continue;
        const record = JSON.parse(text) as { sessionId: string };
        sessions.add(record.sessionId);
    }
    const client = new CopilotClient({
        connection: RuntimeConnection.forStdio({ path: createRequire(import.meta.url).resolve("@github/copilot/npm-loader.js") }),
        env: desktopRuntimeEnvironment(), logLevel: "error",
    });
    try {
        if (sessions.size) {
            await client.start();
            for (const sessionId of sessions) await client.deleteSession(sessionId);
        }
    } finally {
        const errors = await client.stop();
        await rm(workspace, { recursive: true, force: true });
        if (errors.length) throw new AggregateError(errors, "Browser smoke cleanup failed.");
    }
}
