// Captured 2026-09-22 powershell DTO shape; machine paths and identities are replaced.
// Output bytes, preview newline discrepancy, metadata and key sets are preserved.
export function capturedNativeShellFinal() {
  const shellId = "workshop-close-proof-20260922-1035";
  const output = '{\n  "name": "workshop-equipment",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "test": "node --test",\n    "start": "node server.js"\n  }\n}\n';
  const content = `${output}<shellId: ${shellId} completed with exit code 0>`;
  const start = {
    type: "tool.execution_start",
    data: {
      toolCallId: "owned-call", toolName: "powershell",
      arguments: { command: "Get-Content -LiteralPath .\\package.json -Raw",
        description: "Print the current package.json verbatim", shellId, mode: "sync", initial_wait: 30 },
      turnId: "0", model: "gpt-5.6-sol",
      shellToolInfo: { possiblePaths: [".\\package.json"], hasWriteFileRedirection: false },
    },
    id: "owned-start", timestamp: "2026-09-22T02:35:36.654Z", parentId: "owned-assistant",
  };
  const final = {
    type: "tool.execution_complete",
    data: {
      toolCallId: "owned-call", model: "gpt-5.6-sol", interactionId: "owned-interaction",
      turnId: "0", rte: true, success: true,
      result: {
        content, detailedContent: content,
        contents: [{ type: "shell_exit", shellId, exitCode: 0, cwd: "C:\\owned\\workshop", outputPreview: `${output}\n` }],
      },
      toolTelemetry: {
        properties: { customTimeout: "true", executionMode: "sync", detached: "false",
          sandboxApplied: "false", sandboxOptOutRequested: "false" },
        metrics: { commandTimeout: 30000 },
      },
    },
    id: "owned-final", timestamp: "2026-09-22T02:35:58.783Z", parentId: "owned-hook-end",
  };
  const disk = structuredClone(final);
  delete disk.data.result.contents;
  return { start, final, disk };
}
