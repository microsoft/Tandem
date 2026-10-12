import { canOpenDevelopment, useAction, useUi } from "./ui-context.js";
import { ProcessPanel } from "./process-panel.js";
import { useProjectView } from "./project-conversation.js";

export function DevelopmentPanel({ active }: { active: boolean }) {
    const { state, post, refresh } = useUi();
    const action = useAction("development");
    const project = useProjectView();
    const eligible = canOpenDevelopment(state);
    const recoveryNeeded = !project.active && (Boolean(project.error) || ["unknown", "execution-unknown", "failed", "closed"].includes(project.status));
    const snapshot = state.lifecycle.outputs.find(output => output.stageId === "prototype");
    if (!eligible) return <div className="development-empty" role="status">{state.developmentBlocker
        || (state.provider?.canSubmitAnswers === false ? "Open the writable provider for Development."
            : "Finish upstream work or its pending reset before opening Development.")}</div>;
    return <div className="development-workspace">
        <div className="development-toolbar">
            <span>Development: Design, planning, implementation and Review. Your project conversation stays alongside.</span>
            {project.starting && <span role="status">Starting Development...</span>}
            {!project.developmentEntered && <button id="enter-development" type="button" className="plan-button"
                disabled={!eligible} onClick={() => void project.activate()}>Continue in Development</button>}
            {snapshot && <button id="continue-design" type="button" className="plan-button"
                disabled={!eligible || state.lifecycle.currentStage !== "development" || action.busy || project.starting || recoveryNeeded}
                onClick={() => void action.run(async () => {
                    project.prepareDevelopmentView();
                    await post("/api/development/continue", { generation: state.generation,
                        expectedRevision: state.revision, snapshotPath: snapshot.path }, 120000);
                    await refresh();
                })}>{state.development ? "Reconcile Design handoff" : "Continue Design from Prototype"}</button>}
            <details className="development-process"><summary>Acceptance and delivery</summary>{active && <ProcessPanel development />}</details>
        </div>
        {snapshot && recoveryNeeded && <p role="status">Resolve the Development setup or recovery shown in its conversation before continuing the saved Prototype. The handoff is preserved.</p>}
        {(project.error || action.error || state.developmentBlocker) && <div role="alert" className="development-error">
            {project.error || action.error || state.developmentBlocker}
            {project.error && project.url && !project.active && !project.starting
                && <button id="retry-development" className="plan-button" onClick={() => void project.activate(true)}>Retry Development</button>}
        </div>}
        {state.development && <details className="development-provenance"><summary>Saved Prototype handoff</summary>
            <p>Retained handoff: {state.development.handoffId}. Reconciliation never replays retired work.
            Use a new explicit message in Development to continue after recovery.</p></details>}
    </div>;
}
