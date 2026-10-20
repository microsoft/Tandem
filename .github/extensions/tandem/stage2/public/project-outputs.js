// References to verified original views, never copies of artifacts into another store.
export function projectOutputs(snapshot) {
  if (!snapshot?.workflow) return {
    status: snapshot?.installation?.status === "new" ? "not-started" : "unverified",
    reason: snapshot?.installation?.reason || "Development outputs require explicit runtime verification. Browsing does not start it.",
    items: [],
  };
  const items = [];
  const design = snapshot.design;
  for (const artifact of design?.content?.artifacts ?? []) items.push({
    id: `design:${artifact.id}`, group: "Design", title: artifact.title,
    binding: JSON.stringify(design.binding), detail: `Revision ${design.binding.revisionId}`,
    target: { kind: "design", artifactId: artifact.id },
  });
  for (const cycle of snapshot.cycles ?? (snapshot.workflow.currentCycle ? [snapshot.workflow.currentCycle] : [])) {
    if (cycle.plan) items.push({
      id: `plan:${cycle.id}`, group: "Plan", title: cycle.plan.id,
      binding: JSON.stringify([cycle.id, cycle.plan.digest, cycle.plan.version, cycle.design]),
      detail: `Version ${cycle.plan.version} · ${cycle.phase} · ${cycle.id}`,
      target: { kind: "cycle", cycleId: cycle.id },
    });
    if (cycle.implementation) items.push({
      id: `implementation:${cycle.id}`, group: "Implementation", title: `Implementation · ${cycle.plan?.id ?? cycle.id}`,
      binding: JSON.stringify([cycle.id, cycle.implementation.resultId, cycle.implementation.snapshot]),
      detail: `Reported result · ${cycle.phase} · ${cycle.implementation.resultId}`,
      target: { kind: "cycle", cycleId: cycle.id },
    });
  }
  for (const message of snapshot.messages ?? []) if (message.role === "reviewer" && message.id.startsWith("handoff:")) items.push({
    id: `review:${message.id}`, group: "Review", title: message.id.slice("handoff:".length),
    binding: JSON.stringify([message.id, message.requestId, message.timestamp]),
    detail: `Review record · ${message.timestamp}`,
    target: { kind: "message", entryId: message.id },
  });
  return { status: "verified", reason: snapshot.installation?.status === "closed" ? "Verified retained outputs; runtime closed." : "", items };
}
