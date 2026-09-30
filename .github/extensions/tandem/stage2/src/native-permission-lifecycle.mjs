const terminalResults = new Set([
  "approved", "approved-for-session", "approved-for-location", "cancelled", "denied-by-rules",
  "denied-no-approval-rule-and-could-not-request-from-user", "denied-interactively-by-user",
  "denied-by-content-exclusion-policy", "denied-by-permission-request-hook",
]);

export function createNativePermissionLifecycle({ permissions, reportError }) {
  const active = new Set(), byRequestId = new Map(), earlyEvents = [];
  let sessionId;

  function observeBound(event) {
    const data = event.data;
    if (typeof data?.requestId !== "string" || !data.requestId) throw new Error("Native permission event lacks its request identity.");
    if (event.type === "permission.requested") {
      if (data.resolvedByHook) return;
      // The SDK calls the handler with this exact object before notifying onEvent.
      const matches = [...active].filter(entry => entry.sessionId === sessionId && entry.request === data.permissionRequest);
      if (!matches.length) return;
      if (matches.length !== 1) throw new Error("Native permission callback identity is ambiguous.");
      const entry = matches[0], existing = byRequestId.get(data.requestId);
      if ((existing && existing !== entry) || (entry.nativeId && entry.nativeId !== data.requestId)) {
        throw new Error("Native permission request identity changed.");
      }
      entry.nativeId = data.requestId;
      byRequestId.set(data.requestId, entry);
      return;
    }
    const entry = byRequestId.get(data.requestId);
    if (!entry || entry.sessionId !== sessionId) return;
    if (!terminalResults.has(data.result?.kind)
      || (data.toolCallId !== undefined && data.toolCallId !== entry.toolCallId)) {
      throw new Error("Native permission completion does not match the pending request.");
    }
    entry.completion.abort();
  }

  function observe(event) {
    if (!["permission.requested", "permission.completed"].includes(event.type)) return;
    if (!sessionId) { earlyEvents.push(event); return; }
    try { observeBound(event); }
    catch (error) { reportError(error); }
  }

  return {
    observe,
    attach(id) {
      if (typeof id !== "string" || !id || (sessionId && sessionId !== id)
        || [...active].some(entry => entry.sessionId !== id)) {
        throw new Error("Native permission lifecycle requires the exact attached session.");
      }
      sessionId = id;
      for (const event of earlyEvents.splice(0)) observe(event);
    },
    async request(request, invocation) {
      if (!invocation?.sessionId || (sessionId && invocation.sessionId !== sessionId)) {
        throw new Error("Permission request belongs to a different attached session.");
      }
      const entry = { request, sessionId: invocation.sessionId, toolCallId: request.toolCallId,
        completion: new AbortController(), nativeId: null };
      active.add(entry);
      try {
        return await permissions.request(request, invocation, undefined, { nativeCompletion: entry.completion.signal });
      } finally {
        active.delete(entry);
        if (entry.nativeId && byRequestId.get(entry.nativeId) === entry) byRequestId.delete(entry.nativeId);
      }
    },
  };
}
