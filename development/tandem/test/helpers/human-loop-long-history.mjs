import { createHumanLoop, transitionHumanLoop } from "../../runtime-src/domain/human-loop/model.ts";
import { createHumanLoopLedger } from "../../runtime-src/domain/human-loop/ledger.ts";
import { policyHash } from "../../runtime-src/domain/workflow/policy.ts";

export function longHumanHistory(owner, rounds) {
  const design = { revisionId: null, digest: null }, before = { id: "fixture-code", digest: policyHash("fixture-code") };
  let state = createHumanLoop(owner, design), sequence = 0;
  const ledger = createHumanLoopLedger(owner, design);
  const emit = (authority, type, data) => {
    const command = { id: `history-${++sequence}`, expectedRevision: state.revision, type, data };
    state = transitionHumanLoop(state, authority, command);
    ledger.events.push({ authority, command });
  };
  const role = (name, outcome) => {
    const id = `role-${sequence}`, dispatchId = `dispatch-${id}`, messageId = `message-${id}`, interactionId = `interaction-${id}`;
    emit("host", "start-role", { id, dispatchId, sessionId: owner.privateSessionId, requestId: state.activeRequestId,
      cycleId: null, role: name, internalTaskId: null, inputDigest: policyHash(id), before, design });
    emit("runtime", "role-acknowledged", { taskId: id, dispatchId, messageId });
    emit("runtime", "role-started", { taskId: id, messageId, interactionId });
    const resultId = `result-${id}`;
    emit("agent", "submit-result", { schemaVersion: "human-role-result/v1", resultId, inputDigest: policyHash(id), outcome });
    emit("host", "confirm-role-end", { proof: { taskId: id, dispatchId, sessionId: owner.privateSessionId,
      messageId, interactionId, endEventId: `end-${id}`, quiescent: true, termination: "normal", abortAcknowledged: false },
    snapshot: before });
    emit("host", "apply-result", { resultId, designPublication: null });
  };
  for (let round = 0; round < rounds; round++) {
    const id = `original-${round}`;
    emit("user", "receive-request", { id, message: `Exact original request ${round}.\nExplain the current project behavior.`,
      receivedAt: new Date(Date.UTC(2026, 8, 23, 0, round)).toISOString(), answers: null });
    emit("host", "admit-request", { requestId: id });
    role("router", { kind: "route", intent: "answer", cycleId: null, summary: "Explain the current behavior.", resolvedQuestions: [] });
    role("agent", { kind: "answer", summary: `Report ${round}`, report: `Exact retained report ${round}.`, evidenceRefs: [] });
    emit("host", "present-handoff", { handoffId: state.handoffs.at(-1).id });
  }
  return { ledger, state };
}
