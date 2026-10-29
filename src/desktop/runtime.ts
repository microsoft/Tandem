import { dirname, join, resolve } from "node:path";
import { initializeMainSessionModel } from "../../development/tandem/src/main-session-model.mjs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { CopilotClient, type CopilotSession, type ExtensionLaunchProvider, type ResumeSessionConfig } from "@github/copilot-sdk";
import { isPreferredTandemProvider, type TandemProvider } from "../provider-identity.js";
import { DesktopProtocol, validateDesktopUrl } from "./protocol.js";
import { claimDesktopWorkspace } from "./workspace.js";
import { desktopRuntimeEnvironment } from "./environment.js";
import { tandemWorkerInteractionRules } from "../planning-prompts.js";
import { stagePayload, verifyPayload, type TandemPayload } from "../payload.js";
import { APPLICATION_PROTOCOL } from "../../development/tandem/runtime-src/application-interface.js";

export const PRIVATE_CLOSE_DEADLINE_MS = 30_000;
export const MAIN_CLOSE_DEADLINE_MS = 8_000;

export interface DesktopModelSelection {
    model: string;
    reasoningEffort?: ResumeSessionConfig["reasoningEffort"];
}

export function parseDesktopModelSelection(model?: string, effort?: string): DesktopModelSelection | undefined {
    if (model === undefined && effort === undefined) return undefined;
    if (!model?.trim() || model !== model.trim()) throw new Error("Select an explicit non-empty model for the native host.");
    const efforts: NonNullable<ResumeSessionConfig["reasoningEffort"]>[] = ["low", "medium", "high", "xhigh", "max"];
    const reasoningEffort = efforts.find(value => value === effort);
    if (effort !== undefined && reasoningEffort === undefined) throw new Error("The native host reasoning effort is invalid.");
    return { model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
}

export function assertComposedProvider(canvas: { extensionId: string; actions?: { name: string }[] }): void {
    if (!["get_integration", "close_development", "get_application", "execute_application"].every(name => canvas.actions?.some(action => action.name === name))) {
        throw new Error(`The preferred Tandem provider (${canvas.extensionId}) is an older or incompatible installation. It was not replaced or bypassed. Install the matching composed Development build explicitly, then reopen.`);
    }
}

export function assertSourcePreviewProviders(providers: readonly TandemProvider[], sessionId: string): void {
    const expected = `session:${sessionId}:tandem`;
    const conflicting = providers.filter(provider => provider.id.endsWith(":tandem") && provider.id !== expected &&
        provider.status !== "disabled" && provider.status !== "failed");
    if (conflicting.length) {
        throw new Error(`Source preview isolation was not honored: expected only ${expected}, but found ${
            conflicting.map(provider => `${provider.id} (${provider.status})`).join(", ")}. No provider was substituted.`);
    }
}

export function createSourcePreviewLaunchProvider(runtimeDirectory: string, sessionId: string, report: (message: string) => void) {
    let allowed: { entrypoint: string; manifest: TandemPayload } | undefined;
    const provider: ExtensionLaunchProvider = {
        async resolve(entry) {
            const samePath = (a: string, b: string) => process.platform === "win32"
                ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
            if (!allowed || entry.source !== "session" || entry.id !== `session:${sessionId}:tandem` ||
                !samePath(entry.modulePath, allowed.entrypoint)) {
                report(`Source preview did not launch ${entry.id}; only the verified session payload is allowed.`);
                return {};
            }
            const manifest = await verifyPayload(dirname(allowed.entrypoint));
            if (manifest.digest !== allowed.manifest.digest) throw new Error("The source-preview payload changed before launch. No extension was started.");
            report(`Source preview launching ${entry.id}: version ${manifest.version}, payload ${manifest.digest}.`);
            return { launch: { executable: process.execPath,
                args: [join(runtimeDirectory, "source-preview-extension.mjs"), allowed.entrypoint, manifest.digest], env: {} } };
        },
    };
    return { provider, activate(directory: string, manifest: TandemPayload) {
        allowed = { entrypoint: join(directory, "extension.mjs"), manifest };
    } };
}

export function assertComposedVersion(value: unknown, manifest: TandemPayload, extensionId = "unknown"): void {
    value = canvasActionResult(value);
    if (!value || typeof value !== "object" || !("protocol" in value) || value.protocol !== "development/v1" ||
        !("applicationProtocol" in value) || value.applicationProtocol !== APPLICATION_PROTOCOL ||
        !("version" in value) || value.version !== manifest.version ||
        !("payloadDigest" in value) || value.payloadDigest !== manifest.digest) {
        const field = (name: string) => {
            const item: unknown = value && typeof value === "object" ? Reflect.get(value, name) : undefined;
            return typeof item === "string" ? JSON.stringify(item.slice(0, 128)) : "missing or invalid";
        };
        throw new Error(`The preferred Tandem provider (${extensionId}) does not match this Node package's complete payload/version. ` +
            `Expected protocol="development/v1", applicationProtocol=${APPLICATION_PROTOCOL}, version=${JSON.stringify(manifest.version)}, payloadDigest=${manifest.digest}; ` +
            `observed protocol=${field("protocol")}, applicationProtocol=${field("applicationProtocol")}, version=${field("version")}, payloadDigest=${field("payloadDigest")}. ` +
            "No alternate provider was substituted.");
    }

}

export function canvasActionResult(value: unknown): unknown {
    if (!value || typeof value !== "object" || !("result" in value)) {
        throw new Error("Copilot returned an unsupported canvas action response; no result was assumed.");
    }
    return value.result;
}

export function developmentCloseResult(value: unknown): { status: "closed" | "not-started"; warnings: string[] } {
    const result = canvasActionResult(value);
    if (!result || typeof result !== "object" || !("status" in result) ||
        (result.status !== "closed" && result.status !== "not-started") || !("warnings" in result) ||
        !Array.isArray(result.warnings) || result.warnings.some(warning => typeof warning !== "string")) {
        throw new Error("Private Development close was not confirmed. Saved ownership remains authoritative.");
    }
    return { status: result.status, warnings: result.warnings };
}

export function desktopSessionConfig(
    workspace: string, runtimeDirectory: string, protocol: DesktopProtocol, modelSelection?: DesktopModelSelection,
    sourcePreview = false,
): ResumeSessionConfig {
    return {
        ...modelSelection,
        workingDirectory: workspace,
        clientName: "Tandem Desktop",
        streaming: true,
        includeSubAgentStreamingEvents: true,
        enableConfigDiscovery: !sourcePreview,
        ...(sourcePreview ? { enableSkills: true } : {}),
        requestCanvasRenderer: true,
        requestExtensions: true,
        extensionSdkPath: dirname(fileURLToPath(import.meta.resolve("@github/copilot-sdk"))),
        continuePendingWork: false,
        suppressResumeEvent: true,
        onPermissionRequest: protocol.permission.bind(protocol),
        excludedTools: ["ask_user"],
        hooks: {
            onPreToolUse: (input) => input.toolName === "ask_user" ? {
                permissionDecision: "deny",
                permissionDecisionReason: tandemWorkerInteractionRules,
            } : undefined,
        },
        skillDirectories: [join(runtimeDirectory, "skills")],
    };
}

export async function openDesktopSession(
    client: Pick<CopilotClient, "rpc" | "createSession" | "resumeSession">,
    ownership: { sessionId: string; workspace: string; resume: boolean },
    config: ResumeSessionConfig,
): Promise<CopilotSession> {
    if (!ownership.resume) {
        const session = await client.createSession({ ...config, sessionId: ownership.sessionId });
        if (session.sessionId !== ownership.sessionId) {
            throw new Error("Copilot could not create the requested desktop session identity.");
        }
        await session.rpc.name.set({ name: "Tandem Desktop" });
        await client.rpc.sessions.save({ sessionId: ownership.sessionId });
        return session;
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
    modelSelection?: DesktopModelSelection;
    sourcePreview?: boolean;
}): Promise<void> {
    const { protocol, signal } = options;
    if (Number(process.versions.node.split(".")[0]) < 24 || process.versions.electron || process.versions.bun) {
        throw new Error("Tandem requires actual Node 24 or newer. Install Node 24+ before opening this workspace.");
    }
    protocol.send({ type: "permission-mode", mode: protocol.permissionMode });
    const ownership = await claimDesktopWorkspace(options.workspace, (error) => {
        protocol.send({ type: "error", message: `Workspace ownership was lost: ${error.message}` });
        protocol.close();
    });
    const sourcePreview = options.sourcePreview ? createSourcePreviewLaunchProvider(options.runtimeDirectory,
        ownership.sessionId, message => console.error(message)) : undefined;
    const client = new CopilotClient({
        workingDirectory: ownership.workspace, logLevel: "error",
        ...(sourcePreview ? { extensionLaunchProvider: sourcePreview.provider } : {}),
        env: { ...desktopRuntimeEnvironment(), TANDEM_NODE_MAIN_SESSION_ID: ownership.sessionId,
            TANDEM_NODE_EXECUTABLE: process.execPath },
    });
    let session: CopilotSession | undefined;
    let developmentInstance: string | undefined;
    const stopClient = () => {
        protocol.close();
        void client.forceStop().catch((error: unknown) => {
            console.error("Could not terminate the Copilot runtime:", error);
        });
    };
    let shutdownTimeout: ReturnType<typeof setTimeout> | undefined;
    const beginShutdown = () => {
        protocol.close();
        shutdownTimeout ??= setTimeout(stopClient, PRIVATE_CLOSE_DEADLINE_MS + MAIN_CLOSE_DEADLINE_MS);
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
        if (options.modelSelection) {
            const requested = options.modelSelection;
            const selected = (await client.listModels()).find(model => model.id === requested.model);
            if (!selected || selected.policy?.state === "disabled" || options.modelSelection.reasoningEffort
                && !selected.supportedReasoningEfforts?.includes(options.modelSelection.reasoningEffort)) {
                throw new Error("The requested native host model/effort is unavailable; no substitute was selected.");
            }
        }
        const config = desktopSessionConfig(ownership.workspace, options.runtimeDirectory, protocol, options.modelSelection, options.sourcePreview);
        config.onEvent = event => protocol.observeNativeEvent(ownership.sessionId, event);
        session = await openDesktopSession(client, ownership, config);
        await ownership.save();
        if (options.modelSelection) {
            const current = await session.rpc.model.getCurrent();
            if (current.modelId !== options.modelSelection.model || options.modelSelection.reasoningEffort !== undefined
                && current.reasoningEffort !== options.modelSelection.reasoningEffort) {
                throw new Error("The native host did not confirm the requested model/effort; its identity was retained without starting work.");
            }
        } else {
            await initializeMainSessionModel(session);
        }
        signal.throwIfAborted();
        if (!session.workspacePath) throw new Error("The Copilot runtime did not provide a durable session workspace.");
        const extensionDirectory = join(session.workspacePath, "extensions", "tandem");
        const { changed, manifest } = await stagePayload(options.runtimeDirectory, extensionDirectory);
        sourcePreview?.activate(extensionDirectory, manifest);
        protocol.send({ type: "status", message: "Loading Tandem..." });
        if (changed || sourcePreview) {
            await reloadDesktopExtensions(session, signal);
        }
        const sessionId = session.sessionId;
        let extensionId: string | undefined;
        let providerStatus = "not discovered";
        for (let elapsed = 0; elapsed < 30_000; elapsed += protocol.waitingForInput ? 0 : 200) {
            signal.throwIfAborted();
            const providers = await session.rpc.extensions.list();
            if (options.sourcePreview) assertSourcePreviewProviders(providers.extensions, sessionId);
            const catalog = await session.rpc.canvas.list();
            const selected = catalog.canvases.find((canvas) => canvas.canvasId === "tandem" &&
                isPreferredTandemProvider(canvas.extensionId, providers.extensions, sessionId));
            if (selected) assertComposedProvider(selected);
            extensionId = selected?.extensionId;
            if (extensionId) break;
            const tandem = providers.extensions.filter((provider) => provider.name === "tandem");
            if (tandem.length) providerStatus = tandem.map((provider) => `${provider.id}: ${provider.status}`).join(", ");
            if (tandem.length && tandem.every((provider) => provider.status === "failed" || provider.status === "disabled")) break;
            await delay(200, undefined, { signal });
        }
        if (!extensionId) throw new Error(`Tandem did not register a runnable canvas (${providerStatus}). Check extension permissions and the Copilot runtime logs, then reopen the folder.`);
        let qualified = false;
        const showCanvas = (canvas: { canvasId: string; url?: string }) => {
            if (!qualified || canvas.canvasId !== "tandem" || !canvas.url || signal.aborted) return;
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
        session.on("session.error", (event) => protocol.reportSessionError(event));
        // Reopen from durable state without resetting the goal, artifacts, or receipts.
        const canvas = await session.rpc.canvas.open({ canvasId: "tandem", extensionId, instanceId: "desktop-main" });
        developmentInstance = "desktop-main";
        const integration = await session.rpc.canvas.action.invoke({ instanceId: developmentInstance, actionName: "get_integration" });
        assertComposedVersion(integration, manifest, extensionId);
        protocol.send({ type: "status", message: `Verified Tandem provider ${extensionId}: development/v1, version ${manifest.version}, payload ${manifest.digest}.` });
        qualified = true;
        if (!canvas.url) throw new Error("Tandem did not return its application URL.");
        validateDesktopUrl(canvas.url);
        const response = await fetch(new URL("api/state", canvas.url), { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error(`Tandem did not become ready (HTTP ${response.status}).`);
        showCanvas(canvas);
        if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    } finally {
        signal.removeEventListener("abort", beginShutdown);
        shutdownTimeout ??= setTimeout(stopClient, PRIVATE_CLOSE_DEADLINE_MS + MAIN_CLOSE_DEADLINE_MS);
        if (session && developmentInstance) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const response = await Promise.race([
                    session.rpc.canvas.action.invoke({ instanceId: developmentInstance, actionName: "close_development" }),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(
                        "Private Development close remains unconfirmed after its shutdown deadline; ownership was not rebound.")), PRIVATE_CLOSE_DEADLINE_MS); }),
                ]);
                const closed = developmentCloseResult(response);
                for (const warning of closed.warnings) console.error("Development close warning:", warning);
            } catch (error) {
                console.error("Development shutdown failed (saved, closed and uncertain outcomes remain in its own receipt):", error);
            } finally { clearTimeout(timer); }
        }
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
