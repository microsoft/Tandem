export function desktopRuntimeEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const environment = { ...source };
    for (const key of [
        "SESSION_ID", "COPILOT_AGENT_SESSION_ID", "COPILOT_EXTENSION_PARENT_PID", "COPILOT_SDK_PATH",
        "COPILOT_TRAMPOLINE_IDENTIFIER", "COPILOT_TRAMPOLINE_PORT", "COPILOT_TRAMPOLINE_TOKEN",
        "COPILOT_CLI_RESOLVED_DIST_DIR", "COPILOT_CLI_BINARY_VERSION",
    ]) {
        delete environment[key];
    }
    return environment;
}
