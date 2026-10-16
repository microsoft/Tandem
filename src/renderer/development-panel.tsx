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
        {!project.developmentEntered && !snapshot && <div className="development-toolbar">
            <button id="enter-development" type="button" className="plan-button"
                onClick={() => void project.activate()}>Open Development</button>
        </div>}
        <HandoffControls />
        {!project.developmentEntered && snapshot && <p>Review the Prototype above to request Design, or <button id="enter-development"
            type="button" className="plan-button secondary" onClick={() => void project.activate()}>Open Development</button> without submitting it.</p>}
        {(project.error || state.developmentBlocker) && <div role="alert" className="development-error">
            {project.error || state.developmentBlocker}
            {project.error && !project.active && !project.starting
                && <button id="retry-development" className="plan-button" onClick={() => void project.activate(true)}>Retry Development setup</button>}
        </div>}
    </div>;
}
