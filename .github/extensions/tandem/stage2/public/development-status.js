/** Presentation only; native workflow state remains the authority. */
export function developmentStartup(snapshot) {
  return ["starting", "verifying"].includes(snapshot?.startup) ? snapshot.startup
    : snapshot?.installation?.status === "attaching" ? "starting" : null;
}

export function developmentStatus(snapshot, acknowledgement = null) {
  const workflow = snapshot?.workflow, installation = snapshot?.installation;
  const startup = developmentStartup(snapshot);
  if (startup) return snapshot?.accessRequests?.length
    ? { kind: "attention", text: "Permission response needed", requestId: null }
    : { kind: "active", text: startup === "verifying" ? "Verifying Development model..." : "Starting Development...", requestId: null };
  if (!snapshot || snapshot.conversationStatus !== "verified") return {
    kind: installation?.reason ? "attention" : "active", text: installation?.reason ? "Development setup needs attention"
      : (installation?.status === "new" ? "Development not activated" : "Connecting to Development..."), requestId: null,
  };
  const requestId = workflow?.activeRequestId ?? null;
  if (installation?.status === "closed" && requestId)
    return { kind: "attention", text: "Development closed with unfinished work", requestId };
  const permissions = snapshot.accessRequests?.length ?? 0;
  if (permissions) return { kind: "attention", text: "Permission response needed", requestId };
  if (workflow?.questionCounts?.blockers || !requestId && workflow?.questionCounts?.unanswered)
    return { kind: "attention", text: "Questions need your answer", requestId };
  if (workflow?.implementationConfirmations?.some(item => item.status === "pending"))
    return { kind: "attention", text: "Implementation confirmation needed", requestId };
  if (workflow?.queryFailure && ['working', 'waiting-query'].includes(workflow.status)) return {
    kind: workflow.queryFailure.processing === true ? "active" : "attention",
    text: workflow.queryFailure.processing === true ? "Native agent is still processing"
      : workflow.queryFailure.canContinue ? "Model query failed; Continue when ready" : "Model query failed; task retained", requestId };
  if (workflow?.reason || installation?.reason)
    return { kind: "attention", text: "Development needs attention", requestId };
  if (workflow?.compaction?.error) return { kind: "attention", text: "Context compaction failed; see details", requestId };
  if (workflow?.compaction?.active) return { kind: "active", text: "Compacting context...", requestId };
  if (workflow?.compaction?.requested) return { kind: "active", text: "Compaction requested", requestId };
  if (requestId && workflow?.activeCondition === "running") return { kind: "active", text: workflow.activeRole
    ? `${workflow.activeRole[0].toUpperCase()}${workflow.activeRole.slice(1)} working...`
    : "Request awaiting role dispatch", requestId };
  if (requestId) return { kind: ["ended", "queued", null, undefined].includes(workflow?.activeCondition) ? "active" : "attention", text: workflow?.activeCondition === "ended"
    ? "Awaiting verified result" : workflow?.activeCondition === "queued" || !workflow?.activeCondition
      ? "Request awaiting role dispatch" : "Current request needs attention", requestId };
  if (!["ready", "closed"].includes(workflow?.status ?? installation?.status))
    return { kind: "attention", text: "Development needs attention", requestId };
  if (acknowledgement) return { kind: "acknowledgement", text: acknowledgement.text, requestId: acknowledgement.requestId ?? null };
  return { kind: "idle", text: installation?.status === "closed" ? "Development closed" : "Ready", requestId };
}

export function validDevelopmentStatus(value) {
  return value && ["attention", "active", "acknowledgement", "idle"].includes(value.kind)
    && typeof value.text === "string" && value.text.length > 0 && value.text.length <= 2000
    && (value.requestId === null || typeof value.requestId === "string" && value.requestId.length <= 200);
}
