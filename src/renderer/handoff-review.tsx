import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import type { HandoffAdmission, HandoffReview } from "../development-handoff.js";
import { canOpenDevelopment, useAction, useUi } from "./ui-context.js";
import { useProjectView } from "./project-conversation.js";
import { quietHandoff } from "../../development/tandem/public/handoff-presentation.js";

interface HandoffView {
    review(): void; check(): void; busy: boolean; checking: boolean; canReview: boolean;
    admission: HandoffAdmission | null; error: string; status: string; requestId: string | null;
}
const Context = createContext<HandoffView | null>(null);

export function HandoffReviewProvider({ children }: { children: ReactNode }) {
    const { state, pending, post, refresh, browseStage } = useUi();
    const project = useProjectView();
    const action = useAction("prototype-handoff");
    const snapshot = state.lifecycle.outputs.find(output => output.stageId === "prototype");
    const reference = state.development;
    const sameSource = Boolean(reference && reference.snapshotPath === snapshot?.path);
    const key = JSON.stringify([state.prototypeId, state.generation, snapshot?.path, reference]);
    const [check, setCheck] = useState(0);
    const [receipt, setReceipt] = useState<{ key: string; admission: HandoffAdmission | null; error: string } | null>(null);
    const [review, setReview] = useState<HandoffReview | null>(null);
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState("");
    const trigger = useRef<HTMLElement | null>(null);
    const latest = useRef({ state, key }); latest.current = { state, key };
    const checking = sameSource && receipt?.key !== key;
    const admission = receipt?.key === key ? receipt.admission : null;
    const receiptError = receipt?.key === key ? receipt.error : "";
    useEffect(() => {
        if (!sameSource) return;
        let cancelled = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const response = await fetch("/api/development/handoff", { cache: "no-store", signal: controller.signal });
                const value = await response.json();
                if (!response.ok) throw new Error(value.error || "Saved handoff status is unavailable.");
                if (value.generation !== state.generation || value.snapshotPath !== snapshot?.path
                    || value.handoffId !== reference?.handoffId || !value.admission
                    || value.admission.handoffId !== reference?.handoffId || value.admission.requestId !== reference?.requestId
                    || !["prepared", "sending", "admitted", "uncertain"].includes(value.admission.status)) {
                    throw new Error("The saved handoff changed. Check its status before continuing.");
                }
                if (!cancelled) setReceipt({ key, admission: value.admission, error: "" });
            } catch (error) {
                if (!cancelled) setReceipt({ key, admission: null, error: error instanceof Error ? error.message : "Saved handoff status is unavailable." });
            }
        })();
        return () => { cancelled = true; controller.abort(); };
    }, [sameSource, key, state.revision, check]);
    const eligible = canOpenDevelopment(state) && state.lifecycle.currentStage === "development" && Boolean(snapshot);
    const canReview = eligible && !checking && (!sameSource || admission?.status === "prepared" || admission?.status === "uncertain");
    const changed = Boolean(review && (review.generation !== state.generation || review.snapshotPath !== snapshot?.path));
    async function inspect() {
        if (!canReview || pending || action.busy) return;
        trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setReview(null); setOpen(true);
        await action.run(async () => {
            const response = await fetch("/api/development/handoff-review", { cache: "no-store", signal: AbortSignal.timeout(15000) });
            const value: HandoffReview & { error?: string } = await response.json();
            if (!response.ok) throw new Error(value.error || "The saved Prototype could not be read. No work was started.");
            if (latest.current.key !== key || value.generation !== state.generation || value.snapshotPath !== snapshot?.path
                || typeof value.binding !== "string" || !/^[a-f0-9]{64}$/.test(value.binding)
                || typeof value.specification !== "string" || typeof value.workspaceRoot !== "string"
                || ![value.confirmed, value.assumed, value.deferred, value.decisions].every(items =>
                    Array.isArray(items) && items.every(item => typeof item === "string"))) {
                throw new Error("The saved Prototype changed or its summary is unavailable. Review it again; nothing was submitted.");
            }
            setReview(value);
        });
    }
    async function submit() {
        if (!review || changed || !canReview || pending || action.busy) return;
        await action.run(async () => {
            setOpen(false); setPhase("Checking project setup...");
            try {
                if (!await project.requireDevelopmentGit()) return;
                if (latest.current.key !== key) throw new Error("The Prototype changed during project setup. Review it again.");
                project.prepareDevelopmentView(); browseStage("development");
                setPhase("Preparing the saved handoff and opening Development. Native permission may need your answer in the owning session.");
                await post("/api/development/continue", { generation: review.generation,
                    expectedRevision: latest.current.state.revision, snapshotPath: review.snapshotPath, reviewBinding: review.binding }, 120000);
                await refresh();
            } finally {
                setPhase(""); setCheck(value => value + 1);
            }
        });
    }
    const activity = project.handoffActivity?.find(item => item.requestId === admission?.requestId);
    const quiet = quietHandoff(activity, project.visible ? project.designBinding : null, project.permissions);
    const status = phase || (checking ? "Checking saved handoff..."
        : admission?.status === "admitted"
            ? activity ? quiet ? "" : `${activity.label}${project.permissions ? " Native permission is waiting for your answer." : ""}`
                : "Prototype handoff admitted. Waiting for verified Development activity; no duplicate request will be sent."
            : admission?.status === "sending" ? "Prototype handoff submission is pending. Check its status; do not submit again."
                : admission?.status === "uncertain" ? "Admission is uncertain. Review reconciliation of the exact saved request; it may submit only if not admitted. Retired work is never replayed."
                    : admission?.status === "prepared" ? "Saved Prototype handoff has not been submitted. Review it to continue."
                        : receiptError ? "Saved handoff status is unverified." : "Prototype saved. Review its handoff before requesting Design.");
    return <Context.Provider value={{ review: () => void inspect(), check: () => void action.run(async () => {
        await refresh(); setCheck(value => value + 1);
    }),
        busy: action.busy, checking, canReview, admission, error: action.error || receiptError, status,
        requestId: sameSource ? reference?.requestId ?? null : null }}>
        {children}
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal><Dialog.Overlay className="dialog-overlay" />
                <Dialog.Content className="dialog-content handoff-review-dialog" onCloseAutoFocus={event => {
                    event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus();
                }}>
                    <Dialog.Title>Review Prototype handoff</Dialog.Title>
                    <Dialog.Description>Designer will read the saved evidence and create or refine Design in this project.
                        Prototype scripts will not run. This does not implement the app.</Dialog.Description>
                    {!review && action.busy && <p role="status">Reading the saved Prototype...</p>}
                    {review && <>
                        <p><strong>Project folder</strong><br /><span className="project-entry-path">{review.workspaceRoot}</span></p>
                        <p><strong>Saved Prototype</strong> &mdash; revision {review.snapshotRevision}, {review.completedAt}<br />{review.prototype}</p>
                        <p>{review.goal}</p>
                        <details><summary>Saved feature specification</summary><pre>{review.specification}</pre></details>
                        {([["Confirmed decisions", review.confirmed], ["Recorded answers", review.decisions],
                            ["Assumptions (not confirmations)", review.assumed], ["Deferred work (not requested)", review.deferred]] as const).map(([title, items]) =>
                            <details key={title}><summary>{title} ({items.length})</summary>
                                {items.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>None recorded in this saved Prototype.</p>}</details>)}
                        <p>Existing Design is refined in its own Development history, not replaced by the Prototype.
                            Answer any Designer questions there. Implementation requires a separate confirmation.</p>
                        {admission?.status === "uncertain" && <p>Reconciliation checks the same saved request. It may submit if absent and safe; used or retired work is never replayed.</p>}
                        <details><summary>Source details</summary><p>{review.snapshotPath}<br />Snapshot: {review.snapshotHash}</p>
                            {reference && <p>Retained request: {reference.requestId}</p>}</details>
                    </>}
                    {(action.error || changed) && <p role="alert">{changed ? "The saved Prototype changed. Close and review the new handoff before confirming." : action.error}</p>}
                    <div className="dialog-actions">
                        <button id="cancel-design-handoff" type="button" className="plan-button secondary"
                            onClick={() => setOpen(false)}>Cancel</button>
                        {review && <button id="confirm-design-handoff" type="button" className="plan-button"
                            disabled={action.busy || pending || changed || !canReview} onClick={() => void submit()}>
                            {admission?.status === "uncertain" ? "Reconcile saved handoff"
                                : project.designRevision ? "Refine Design from Prototype" : "Create Design from Prototype"}</button>}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    </Context.Provider>;
}

export function HandoffControls({ prototype = false, active = true }: { prototype?: boolean; active?: boolean }) {
    const view = useContext(Context);
    const { pending, state } = useUi();
    const { setHandoffStatusOwner } = useProjectView();
    const hasSnapshot = state.lifecycle.outputs.some(output => output.stageId === "prototype");
    useEffect(() => {
        if (!active || !hasSnapshot || !view) return;
        setHandoffStatusOwner(view.requestId);
        return () => setHandoffStatusOwner(null);
    }, [active, hasSnapshot, view?.requestId, setHandoffStatusOwner]);
    if (!view || !hasSnapshot || !view.status && !view.canReview && !view.error) return null;
    return <section className="development-handoff-status" aria-label="Prototype handoff">
        {view.status && <p role="status">{view.status}</p>}
        {view.canReview && <button id={prototype ? "review-prototype-handoff" : "continue-design"} type="button" className="plan-button"
            disabled={pending || view.busy} onClick={view.review}>
            {prototype ? "Continue to Development" : view.admission?.status === "uncertain" ? "Review handoff recovery"
                : view.admission ? "Review saved handoff" : state.development ? "Review updated Prototype" : "Review Prototype handoff"}</button>}
        {(view.error || view.admission?.status === "sending") && <button id={prototype ? "check-prototype-handoff" : "check-design-handoff"}
            type="button" className="plan-button secondary" disabled={view.busy || view.checking} onClick={view.check}>Check handoff status</button>}
        {view.error && <p role="alert">{view.error}</p>}
    </section>;
}
