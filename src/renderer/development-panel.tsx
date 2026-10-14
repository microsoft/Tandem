import { canOpenDevelopment, useUi } from "./ui-context.js";
import { useProjectView } from "./project-conversation.js";
import { HandoffControls } from "./handoff-review.js";

export function DevelopmentPanel({ active }: { active: boolean }) {
    const { state } = useUi();
    const project = useProjectView();
    const eligible = canOpenDevelopment(state);
    if (!active) return null;
    if (!eligible) return <div className="development-empty" role="status">{state.developmentBlocker
        || (state.provider?.canSubmitAnswers === false ? "Open the writable provider for Development."
            : "Finish upstream work or its pending reset before opening Development.")}</div>;
    const snapshot = state.lifecycle.outputs.some(output => output.stageId === "prototype");
    return <div className="development-workspace">
        <div className="development-toolbar">
            <span>Development: Design, planning, implementation and Review.</span>
            {project.starting && <span role="status">Opening Development. Complete any native permission request in the owning session.</span>}
            {!project.developmentEntered && !snapshot && <button id="enter-development" type="button" className="plan-button"
                onClick={() => void project.activate()}>Open Development</button>}
        </div>
        <HandoffControls />
        {!project.developmentEntered && snapshot && <p>Review the Prototype above to request Design, or <button id="enter-development"
            type="button" className="plan-button secondary" onClick={() => void project.activate()}>Open Development</button> without submitting it.</p>}
        {project.developmentEntered && !project.url && <p role="status">Development view is not connected yet. No Design result has been verified.</p>}
        {project.detail && <p role="status">{project.detail}</p>}
        {(project.error || state.developmentBlocker) && <div role="alert" className="development-error">
            {project.error || state.developmentBlocker}
            {project.error && !project.active && !project.starting
                && <button id="retry-development" className="plan-button" onClick={() => void project.activate(true)}>Retry Development setup</button>}
        </div>}
        {state.development && <details className="development-provenance"><summary>Saved handoff details</summary>
            <p>Retained request: {state.development.requestId}. Used or retired work is never replayed.
                Implementation still requires its separate confirmation.</p></details>}
    </div>;
}
