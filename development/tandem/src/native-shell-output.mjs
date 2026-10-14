import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { requireCondition as check } from "../runtime-src/domain/workflow/validation.ts";

/** Correlates output events; the caller must verify the start against its live shell journal. */
export class NativeShellOutput {
  #events = new Map();
  #notifications = new Map();
  #messages = new Map();
  #calls = new Map();
  #starts = new Map();
  observe(event, active, sessionId) {
    const data = event.data ?? {};
    const previous = this.#events.get(event.id);
    if (previous) {
      check(previous === policyHash(event), "Automatic output event identity changed.");
      return { kind: "duplicate" };
    }
    let effect = null;
    if (event.type === "system.notification" && data.kind?.type === "shell_completed") {
      this.#notifications.set(event.id, event);
    } else if (event.type === "assistant.message" && this.#notifications.has(event.parentId)
      && data.content === "" && data.toolRequests?.length === 1 && data.toolRequests[0].name === "read_powershell") {
      this.#messages.set(event.id, { message: event, notification: this.#notifications.get(event.parentId) });
    } else if (event.type === "tool.execution_start" && data.toolName === "read_powershell"
      && data.turnId === undefined && data.interactionId === undefined) {
      const context = this.#messages.get(event.parentId), request = context?.message.data.toolRequests[0];
      check(context
        && !event.agentId && (!event.sessionId || event.sessionId === sessionId),
      "Automatic output collection lacks exact owned notification ancestry.");
      const notification = context.notification, args = data.arguments;
      check(!notification.agentId && !context.message.agentId
        && (!notification.sessionId || notification.sessionId === sessionId)
        && (!context.message.sessionId || context.message.sessionId === sessionId)
        && Number.isInteger(notification.data.kind.exitCode)
        && typeof data.toolCallId === "string" && data.toolCallId.length > 0
        && request.toolCallId === data.toolCallId && policyHash(request.arguments) === policyHash(args)
        && args && Object.keys(args).sort().join(",") === "delay,shellId"
        && args.delay === 0 && args.shellId === notification.data.kind.shellId
        && !active?.nativeCalls.has(data.toolCallId) && !this.#calls.has(data.toolCallId),
      "Automatic output collection changed its exact shell, call or passive arguments.");
      const call = { notification, start: event };
      this.#calls.set(data.toolCallId, call); this.#starts.set(event.id, call);
      effect = { kind: "start", notification, toolCallId: data.toolCallId };
    } else if (event.type === "tool.execution_complete") {
      const call = this.#calls.get(data.toolCallId) ?? this.#starts.get(event.parentId);
      if (!call) return null;
      check(event.parentId === call.start.id
        && data.toolCallId === call.start.data.toolCallId && data.turnId === undefined && data.interactionId === undefined
        && !event.agentId && (!event.sessionId || event.sessionId === sessionId) && typeof data.success === "boolean",
      "Automatic output completion lacks its exact start and call identity.");
      check(!call.completed, "Automatic output collection completed more than once.");
      call.completed = true;
      effect = { kind: "complete", toolCallId: data.toolCallId };
    } else return null;
    check(typeof event.id === "string" && event.id.length > 0, "Automatic output event identity is invalid.");
    this.#events.set(event.id, policyHash(event));
    return effect;
  }
}
