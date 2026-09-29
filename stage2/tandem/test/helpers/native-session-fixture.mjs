import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { validatePolicyShape } from "../../runtime-src/domain/workflow/policy-contracts.ts";

export const git = async (cwd, ...args) => (await promisify(execFile)("git", ["-C", cwd, ...args])).stdout.trim();

export class NativeSession {
  sessionId = "private";
  events = [];
  sends = [];
  count = 0;
  processing = false;
  onSend = null;
  factory = {
    getRun: async () => assert.fail("This fixture has no factory run."),
    cancel: async () => assert.fail("This fixture has no factory to cancel."),
  };
  rpc = {
    extensions: { list: async () => ({ extensions: [{ name: "tandem", status: "running", pid: process.pid }] }) },
    tools: { initializeAndValidate: async () => ({}),
      getCurrentMetadata: async () => ({ tools: [{ name: "tandem_collect_review_scopes" }] }) },
    mode: { get: async () => "interactive" },
    metadata: { isProcessing: async () => ({ processing: this.processing }), activity: async () => ({ hasActiveWork: false }) },
    queue: { pendingItems: async () => ({ items: [], steeringMessages: [] }) },
  };
  emit(type, data) {
    const event = { id: `event-${++this.count}`, parentId: null, timestamp: new Date().toISOString(), type, data };
    if (type !== "assistant.idle") this.events.push(event);
    this.config.onEvent(event);
  }
  async send(input) {
    this.sends.push(input);
    const messageId = `message-${this.sends.length}`;
    await this.onSend?.(input, messageId);
    return messageId;
  }
  async getEvents() { return structuredClone(this.events); }
  start() {
    this.processing = true;
    const messageId = `message-${this.sends.length}`;
    this.emit("user.message", { content: "Owned synthetic task.", messageId, turnId: "0", interactionId: messageId, delivery: "idle" });
    this.emit("assistant.turn_start", { turnId: "0", interactionId: messageId });
  }
  idle() { this.processing = false; this.emit("assistant.idle", {}); }
  async call(name, args) {
    const tool = this.config.tools.find((tool) => tool.name === name);
    validatePolicyShape(tool.parameters, args);
    const hook = await this.config.hooks.onPreToolUse({
      sessionId: this.sessionId, timestamp: new Date(), workingDirectory: this.config.workingDirectory, toolName: name, toolArgs: args,
    }, { sessionId: this.sessionId });
    assert.notEqual(hook.permissionDecision, "deny", `${name}: ${hook.permissionDecisionReason ?? "No rejection reason"}`);
    if (hook.permissionDecision !== "allow" && tool.skipPermission !== true) {
      const permission = await this.config.onPermissionRequest({
        kind: "custom-tool", toolName: name, toolDescription: tool.description, args,
      }, { sessionId: this.sessionId, managedSettingsEnabled: false });
      assert.ok(["approve-once", "approve-for-session"].includes(permission.kind), "Explicit command permission is required.");
    }
    return tool.handler(args, { sessionId: this.sessionId, toolName: name, toolCallId: `tool-${++this.count}`, arguments: args });
  }
}

export async function waitFor(observe, description, { timeout = 30_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await observe();
    if (value) return value;
    await delay(10);
  }
  assert.fail(`Timed out waiting for ${description}.`);
}
