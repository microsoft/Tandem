import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CopilotClient, type CopilotSession, type ResumeSessionConfig } from "@github/copilot-sdk";
import { isPreferredTandemProvider } from "../provider-identity.js";
import { DesktopProtocol, validateDesktopUrl } from "./protocol.js";
import { claimDesktopWorkspace } from "./workspace.js";
import { desktopRuntimeEnvironment } from "./environment.js";

export async function openDesktopSession(
    client: Pick<CopilotClient, "rpc" | "resumeSession">,
    ownership: { sessionId: string; workspace: string; resume: boolean },
    config: ResumeSessionConfig,
): Promise<CopilotSession> {
    if (!ownership.resume) {
        // Unnamed SDK sessions are not durable until a user turn; desktop factories do not need one.
        const opened = await client.rpc.sessions.open({
            kind: "create",
            options: { sessionId: ownership.sessionId, name: "Tandem Desktop",
                workingDirectory: ownership.workspace, clientName: "Tandem Desktop" },
        });
        if (opened.status !== "created" || opened.sessionId !== ownership.sessionId) {
            throw new Error("Copilot could not create the requested desktop session identity.");
        }
        await client.rpc.sessions.save({ sessionId: ownership.sessionId });
    }
    return client.resumeSession(ownership.sessionId, config);
}

export async function reloadDesktopExtensions(session: Pick<CopilotSession, "rpc">, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + 30_000;
    for (;;) {
        signal.throwIfAborted();
        try {
            await session.rpc.extensions.reload();
            return;
        } catch (error) {
            // Session creation returns before configuration discovery installs the extension manager.
            if (!(error instanceof Error) || !error.message.endsWith("Extensions not available") || Date.now() >= deadline) throw error;
            await delay(200, undefined, { signal });
        }
    }
}

export async function runDesktopRuntime(options: {
    workspace: string;
    runtimeDirectory: string;
    protocol: DesktopProtocol;
    signal: AbortSignal;
}): Promise<void> {
    const { protocol, signal } = options;
    const ownership = await claimDesktopWorkspace(options.workspace, (error) => {
        protocol.send({ type: "error", message: `Workspace ownership was lost: ${error.message}` });
        protocol.close();
    });
    const client = new CopilotClient({
        workingDirectory: ownership.workspace, logLevel: "error", env: desktopRuntimeEnvironment(),
    });
    let session: CopilotSession | undefined;
    const stopClient = () => {
        protocol.close();
        void client.forceStop().catch((error: unknown) => {
            console.error("Could not terminate the Copilot runtime:", error);
        });
    };
    let shutdownTimeout: ReturnType<typeof setTimeout> | undefined;
    const beginShutdown = () => {
        protocol.close();
        shutdownTimeout ??= setTimeout(stopClient, 8_000);
    };
    signal.addEventListener("abort", beginShutdown, { once: true });
    try {
        signal.throwIfAborted();
        protocol.send({ type: "status", message: "Starting the independent Copilot runtime..." });
        await client.start();
        signal.throwIfAborted();
        const auth = await client.getAuthStatus();
        if (!auth.isAuthenticated) {
            throw new Error("Copilot is not signed in. Run 'copilot login' in a terminal, complete sign-in, then reopen this folder. No Copilot app is required.");
        }
        const config = {
            workingDirectory: ownership.workspace,
            clientName: "Tandem Desktop",
            enableConfigDiscovery: true,
            requestCanvasRenderer: true,
            requestExtensions: true,
            // The native host, not the extension or a blanket auto-approval policy, owns consent.
            onPermissionRequest: (request: Parameters<DesktopProtocol["permission"]>[0]) => protocol.permission(request),
            onUserInputRequest: (request: Parameters<DesktopProtocol["question"]>[0]) => protocol.question(request),
            skillDirectories: [join(options.runtimeDirectory, "skills")],
        };
        session = await openDesktopSession(client, ownership, config);
        await ownership.save();
        signal.throwIfAborted();
        if (!session.workspacePath) throw new Error("The Copilot runtime did not provide a durable session workspace.");
        const extensionDirectory = join(session.workspacePath, "extensions", "tandem");
        await mkdir(extensionDirectory, { recursive: true });
        const bundledPath = join(options.runtimeDirectory, "extension.mjs");
        const stagedPath = join(extensionDirectory, "extension.mjs");
        let staged: Buffer | undefined;
        try {
            staged = await readFile(stagedPath);
        } catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
        }
        const changed = !staged?.equals(await readFile(bundledPath));
        protocol.send({ type: "status", message: "Loading Tandem..." });
        if (changed) {
            await copyFile(bundledPath, stagedPath);
            await reloadDesktopExtensions(session, signal);
        }
        const sessionId = session.sessionId;
        let extensionId: string | undefined;
        let providerStatus = "not discovered";
        for (let elapsed = 0; elapsed < 30_000; elapsed += protocol.waitingForInput ? 0 : 200) {
            signal.throwIfAborted();
            const providers = await session.rpc.extensions.list();
            const catalog = await session.rpc.canvas.list();
            extensionId = catalog.canvases.find((canvas) => canvas.canvasId === "tandem" &&
                isPreferredTandemProvider(canvas.extensionId, providers.extensions, sessionId))?.extensionId;
            if (extensionId) break;
            const tandem = providers.extensions.filter((provider) => provider.name === "tandem");
            if (tandem.length) providerStatus = tandem.map((provider) => `${provider.id}: ${provider.status}`).join(", ");
            if (tandem.length && tandem.every((provider) => provider.status === "failed" || provider.status === "disabled")) break;
            await delay(200, undefined, { signal });
        }
        if (!extensionId) throw new Error(`Tandem did not register a runnable canvas (${providerStatus}). Check extension permissions and the Copilot runtime logs, then reopen the folder.`);
        const showCanvas = (canvas: { canvasId: string; url?: string }) => {
            if (canvas.canvasId !== "tandem" || !canvas.url || signal.aborted) return;
            try {
                protocol.send({
                    type: "ready", url: validateDesktopUrl(canvas.url).href,
                    workspace: resolve(options.workspace), sessionId: ownership.sessionId,
                });
            } catch (error) {
                protocol.send({ type: "error", message: error instanceof Error ? error.message : "Invalid Tandem canvas." });
            }
        };
        session.on("session.canvas.opened", (event) => showCanvas(event.data));
        session.on("session.error", (event) => protocol.send({ type: "error", message: event.data.message }));
        // Reopen from durable state without resetting the goal, artifacts, or receipts.
        const canvas = await session.rpc.canvas.open({ canvasId: "tandem", extensionId, instanceId: "desktop-main" });
        if (!canvas.url) throw new Error("Tandem did not return its application URL.");
        validateDesktopUrl(canvas.url);
        const response = await fetch(new URL("api/state", canvas.url), { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error(`Tandem did not become ready (HTTP ${response.status}).`);
        showCanvas(canvas);
        if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    } finally {
        signal.removeEventListener("abort", beginShutdown);
        shutdownTimeout ??= setTimeout(stopClient, 8_000);
        try {
            if (session) {
                for (const canvas of session.openCanvases) {
                    await session.rpc.canvas.close({ instanceId: canvas.instanceId });
                }
            }
        } catch (error) {
            console.error("Tandem canvas shutdown failed:", error);
        }
        try {
            const errors = await client.stop();
            for (const error of errors) console.error("Copilot shutdown failed:", error);
        } finally {
            clearTimeout(shutdownTimeout);
            await ownership.release();
        }
    }
}
