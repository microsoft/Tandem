import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import type { HandoffAdmission } from "../development-handoff.js";
import { canOpenDevelopment, useAction, useUi } from "./ui-context.js";
import { ProcessPanel } from "./process-panel.js";
import { useProjectView } from "./project-conversation.js";

export function DevelopmentPanel({ active }: { active: boolean }) {
    const { state, post, refresh, pending } = useUi();
    const action = useAction("development");
    const project = useProjectView();
    const eligible = canOpenDevelopment(state);
    const recoveryNeeded = !project.active && (Boolean(project.error) || ["unknown", "execution-unknown", "failed", "closed"].includes(project.status));
    const snapshot = state.lifecycle.outputs.find(output => output.stageId === "prototype");
    const [processOpen, setProcessOpen] = useState(false);
    const [check, setCheck] = useState(0);
    const reference = state.development;
    const sameSource = Boolean(reference && reference.snapshotPath === snapshot?.path);
    const key = JSON.stringify([state.prototypeId, state.generation, snapshot?.path, reference]);
    const [receipt, setReceipt] = useState<{ key: string; admission: HandoffAdmission | null; error: string } | null>(null);
    const checking = sameSource && receipt?.key !== key;
    const admission = receipt?.key === key ? receipt.admission : null;
    const receiptError = receipt?.key === key ? receipt.error : "";
    useEffect(() => { if (!active) setProcessOpen(false); }, [active]);
    useEffect(() => {
        if (!active || !sameSource || !eligible) return;
        let cancelled = false;
        const controller = new AbortController();
        setReceipt(null);
        void (async () => {
            try {
                const response = await fetch("/api/development/handoff", { cache: "no-store", signal: controller.signal });
                const value = await response.json();
                if (!response.ok) throw new Error(value.error || "Saved handoff status is unavailable.");
                if (value.generation !== state.generation || value.snapshotPath !== snapshot?.path
                    || value.handoffId !== reference?.handoffId || !value.admission
                    || value.admission.handoffId !== reference?.handoffId || value.admission.requestId !== reference?.requestId
                    || !["prepared", "sending", "admitted", "uncertain"].includes(value.admission.status)) {
                    throw new Error("The saved handoff changed. Refresh its status before continuing.");
                }
                if (!cancelled) setReceipt({ key, admission: value.admission, error: "" });
            } catch (error) {
                if (!cancelled) setReceipt({ key, admission: null, error: error instanceof Error ? error.message : "Saved handoff status is unavailable." });
            }
        })();
        return () => { cancelled = true; controller.abort(); };
    }, [active, eligible, sameSource, key, state.revision, check]);
    const blocked = !eligible || pending || state.lifecycle.currentStage !== "development" || action.busy || project.starting || recoveryNeeded;
    const canContinue = !sameSource || admission?.status === "prepared" || admission?.status === "uncertain";
    if (!eligible) return <div className="development-empty" role="status">{state.developmentBlocker
        || (state.provider?.canSubmitAnswers === false ? "Open the writable provider for Development."
            : "Finish upstream work or its pending reset before opening Development.")}</div>;
    return <div className="development-workspace">
        <div className="development-toolbar">
            <span>Development: Design, planning, implementation and Review. Your project conversation stays alongside.</span>
            {project.starting && <span role="status">Starting Development...</span>}
            {!project.developmentEntered && <button id="enter-development" type="button" className="plan-button"
                disabled={!eligible} onClick={() => void project.activate()}>Continue in Development</button>}
            {snapshot && canContinue && <button id="continue-design" type="button" className={`plan-button${admission?.status === "uncertain" ? " secondary" : ""}`}
                disabled={blocked || checking}
                onClick={() => void action.run(async () => {
                    project.prepareDevelopmentView();
                    try {
                        await post("/api/development/continue", { generation: state.generation,
                            expectedRevision: state.revision, snapshotPath: snapshot.path }, 120000);
                        await refresh();
                    } finally { setCheck(value => value + 1); }
                })}>{admission?.status === "uncertain" ? "Reconcile saved handoff"
                    : admission?.status === "prepared" ? "Continue saved Prototype handoff"
                    : reference ? "Continue Design from updated Prototype" : "Continue Design from Prototype"}</button>}
            <Dialog.Root open={processOpen && active} onOpenChange={setProcessOpen}>
                <Dialog.Trigger asChild><button id="acceptance-delivery" className="plan-button secondary" type="button">Acceptance, export and delivery</button></Dialog.Trigger>
                {active && <Dialog.Portal><Dialog.Overlay className="dialog-overlay process-dialog-overlay" />
                    <Dialog.Content className="dialog-content process-dialog" onCloseAutoFocus={event => { if (!active) event.preventDefault(); }}>
                        <div className="root-settings-heading"><Dialog.Title>Acceptance, export and delivery</Dialog.Title>
                            <Dialog.Close id="close-acceptance-delivery" className="plan-button secondary">Close</Dialog.Close></div>
                        <Dialog.Description>Optional advanced controls for recording acceptance, exporting saved outcomes and delivering reviewed work. These are not required to continue Design. Export does not publish.</Dialog.Description>
                        <ProcessPanel development expanded />
                    </Dialog.Content></Dialog.Portal>}
            </Dialog.Root>
        </div>
        {snapshot && sameSource && <div className="development-handoff-status">
            <span role="status">{checking ? "Checking saved handoff..."
                : admission?.status === "admitted" ? "Prototype handoff admitted. Continue in the Development conversation; implementation still requires confirmation."
                : admission?.status === "sending" ? "Prototype handoff submission is pending. Check its status before taking another action."
                : admission?.status === "uncertain" ? "Admission is uncertain. Reconciliation checks the exact saved request and may submit it if not admitted; retired work is never replayed."
                : admission?.status === "prepared" ? "Saved Prototype handoff has not been submitted." : "Saved handoff status is unverified."}</span>
            {(receiptError || admission?.status === "sending") && <button id="check-design-handoff" type="button" className="plan-button secondary"
                disabled={pending || action.busy || checking} onClick={() => setCheck(value => value + 1)}>Check handoff status</button>}
            {receiptError && <p role="alert">{receiptError}</p>}
        </div>}
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
