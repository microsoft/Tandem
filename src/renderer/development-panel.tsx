import { canOpenDevelopment, useAction, useUi } from "./ui-context.js";
import { ProcessPanel } from "./process-panel.js";
import { useProjectView } from "./project-conversation.js";

export function DevelopmentPanel({ active }: { active: boolean }) {
    const { state, post, refresh } = useUi();
    const action = useAction("development");
    const project = useProjectView();
    const eligible = canOpenDevelopment(state);
    const snapshot = state.lifecycle.outputs.find(output => output.stageId === "prototype");
    if (!eligible) return <div className="development-empty" role="status">{state.developmentBlocker
        || (state.provider?.canSubmitAnswers === false ? "Open the writable provider for Development."
            : "Finish upstream work or its pending reset before opening Development.")}</div>;
    return <div className="development-workspace">
        <div className="development-toolbar">
            <span>Design artifacts. Your project conversation and current work stay beside this view.</span>
            {!project.active && <button id="activate-development" type="button" className="plan-button" disabled={!eligible}
                onClick={() => void project.activate()}>Activate Development</button>}
            {snapshot && <button id="continue-design" type="button" className="plan-button"
                disabled={!eligible || state.lifecycle.currentStage !== "development" || action.busy}
                onClick={() => void action.run(async () => {
                    await post("/api/development/continue", { generation: state.generation,
                        expectedRevision: state.revision, snapshotPath: snapshot.path }, 120000);
                    await refresh();
                })}>{state.development ? "Reconcile Design handoff" : "Continue Design from Prototype"}</button>}
            <details className="development-process"><summary>Acceptance and delivery</summary>{active && <ProcessPanel development />}</details>
        </div>
        {(project.error || action.error || state.developmentBlocker) && <div role="alert" className="development-error">
            {project.error || action.error || state.developmentBlocker}
        </div>}
        {state.development && <p className="development-provenance">Retained handoff: {state.development.handoffId}.
            Reconciliation never replays retired work. Use a new explicit message in Development to continue after recovery.</p>}
    </div>;
}
