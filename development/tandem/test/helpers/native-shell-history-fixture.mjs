export function nativeShellHookFixture(toolName = "powershell") {
  const output = "Status: café 漢字\n";
  const text = `${output}<shellId: owned completed with exit code 0>`;
  return {
    id: "shell-hook", type: "hook.start", timestamp: "2026-09-21T10:37:38.206Z", parentId: "permission",
    agentId: "agent",
    data: { hookInvocationId: "hook-invocation", hookType: "postToolUse", input: {
      sessionId: "private", timestamp: 1789987058206, cwd: "C:\\owned", toolName,
      toolArgs: { shellId: "owned", ...(toolName === "powershell" ? { command: "fixture", mode: "sync" } : { delay: 1 }) },
      toolResult: { textResultForLlm: text, sessionLog: text, resultType: "success",
        contents: [{ type: "shell_exit", shellId: "owned", exitCode: 0, cwd: "C:\\owned", outputPreview: output }],
        toolTelemetry: { properties: { executionMode: "sync" }, metrics: { commandTimeout: 120000 } },
      },
    } },
  };
}

export function retainedShellHook(event, { omit = true, text = true, log = true } = {}) {
  const retained = structuredClone(event), result = retained.data.input.toolResult;
  if (omit) delete result.contents;
  for (const [field, enabled] of [["textResultForLlm", text], ["sessionLog", log]]) if (enabled) {
    result[field] = `[copilot:elided ${field} (${Buffer.byteLength(result[field], "utf8")} bytes) — pre-hook tool result; the final result may differ, see the adjacent tool.execution_complete event]`;
  }
  return retained;
}
