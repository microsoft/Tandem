import { Button } from "./ui/index.js";
import { useRef } from "react";
import { isPendingFactoryRun } from "../agent-runner.js";
import { hasActiveJobs, useAction, useUi } from "./ui-context.js";

export function DiscoveryRecovery() {
    const { state, confirm, post, pending } = useUi();
    const action = useAction("discovery-recovery");
    const decisions = useRef(new Map<string, { decisionId: string; expectedRevision: number }>());
    const unknown = state.factoryRuns?.filter(receipt => receipt.runId === null && isPendingFactoryRun(receipt)) ?? [];
    const recovered = state.factoryRuns?.filter(receipt => receipt.recovery) ?? [];
    if (!unknown.length && !recovered.length) return null;
    return <section className="section discovery-recovery" aria-label="Discovery recovery">
        {unknown.map(receipt => <div key={receipt.requestId}>
            <p>Unconfirmed launch: <code>{receipt.requestId}</code>. Its outcome is unknown.</p>
            <Button variant="secondary" type="button" data-recovery-request-id={receipt.requestId}
                disabled={pending || hasActiveJobs(state) || !state.jobOwner || state.provider?.canSubmitAnswers === false}
                onClick={() => void action.run(async () => {
                    const key = `${state.generation}:${receipt.requestId}`;
                    let decision = decisions.current.get(key);
                    if (!decision) {
                        if (!await confirm(`Abandon request ${receipt.requestId} with an uncertain outcome?\n\nOwner: ${state.jobOwner?.sessionId}\nWorkspace: ${state.jobOwner?.workspaceRoot}\n\nRecovery must verify idle native work and an empty queue. This preserves the original unknown launch and all saved Requirements. It does not claim success, prove the launch never ran, reset the project, or replay anything. Continue only with a separate explicit action.`, "Recover interrupted discovery")) return;
                        decision = { decisionId: crypto.randomUUID(), expectedRevision: state.revision };
                        decisions.current.set(key, decision);
                    }
                    await post("/api/effort/recover", { ...decision, generation: state.generation,
                        requestId: receipt.requestId, owner: state.jobOwner, confirm: true });
                })}>Recover interrupted discovery</Button>
        </div>)}
        {recovered.map(receipt => <p key={receipt.requestId}>Request <code>{receipt.requestId}</code>: abandoned with
            uncertain outcome at {receipt.recovery!.recordedAt}. No automatic replay.</p>)}
        {action.error && <p role="alert">{action.error}</p>}
    </section>;
}
