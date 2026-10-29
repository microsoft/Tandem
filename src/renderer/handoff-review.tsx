import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Status } from "./ui/index.js";
import type { HandoffAdmission, HandoffReview } from "../development-handoff.js";
import { canOpenDevelopment, useAction, useUi } from "./ui-context.js";
import { useProjectView } from "./project-conversation.js";
import { handoffProgress } from "../../development/tandem/public/handoff-presentation.js";

interface HandoffView {
    continue(): void; check(): void; busy: boolean; checking: boolean; canContinue: boolean;
    admission: HandoffAdmission | null; error: string; status: string; progress: string; requestId: string | null;
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
    const [phase, setPhase] = useState("");
    const submitting = useRef(false);
    const latest = useRef({ state, key }); latest.current = { state, key };
    const checking = sameSource && receipt?.key !== key;
    const admission = receipt?.key === key ? receipt.admission : null;
    const receiptError = receipt?.key === key ? receipt.error : "";
    const intent = state.developmentIntent?.generation === state.generation ? state.developmentIntent : null;
    useEffect(() => {
        if (state.lifecycle.currentStage === "development" && intent && !project.developmentEntered) project.prepareDevelopmentView();
    }, [state.lifecycle.currentStage, intent, project.developmentEntered]);
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
    const canContinue = eligible && !checking && !project.starting && !project.recoveryAction && intent?.status !== "starting"
        && (!sameSource || admission?.status === "prepared" || admission?.status === "uncertain");
    async function submit() {
        if (!canContinue || pending || action.busy || submitting.current) return;
        submitting.current = true;
        await action.run(async () => {
            setPhase("Preparing Development...");
            try {
                if (!await project.requireDevelopmentGit()) return;
                const response = await fetch("/api/development/handoff-review", { cache: "no-store", signal: AbortSignal.timeout(15000) });
                const value: HandoffReview & { error?: string } = await response.json();
                if (!response.ok) throw new Error(value.error || "The saved Prototype could not be read. No work was started.");
                if (latest.current.key !== key || value.generation !== state.generation || value.snapshotPath !== snapshot?.path
                    || typeof value.binding !== "string" || !/^[a-f0-9]{64}$/.test(value.binding)) {
                    throw new Error("The saved Prototype changed. Check the current version before continuing.");
                }
                project.prepareDevelopmentView(); browseStage("development");
                setPhase("Opening Development...");
                await post("/api/development/continue", { generation: value.generation,
                    expectedRevision: latest.current.state.revision, snapshotPath: value.snapshotPath, reviewBinding: value.binding }, 120000);
                await refresh();
            } finally {
                setPhase(""); setCheck(value => value + 1);
            }
        });
        submitting.current = false;
    }
    const activity = project.handoffActivity?.find(item => item.requestId === admission?.requestId);
    const unrelated = Boolean(project.activeRequestId && project.activeRequestId !== reference?.requestId);
    const error = action.error || receiptError || (intent?.status === "failed" ? intent.error : "");
    const progress = phase || (unrelated || project.attention || project.detail || project.compacting ? "" : checking ? "Checking saved handoff..."
        : admission?.status === "admitted" ? activity ? handoffProgress(activity, project.designBinding, project.permissions)
            : "Waiting for verified Development activity..."
          : intent?.status === "starting" && !error ? "Opening Development with the saved Prototype..." : "");
    const status = project.recoveryAction ? `Use ${project.recoveryAction === "initial-creation" ? "Inspect unused setup recovery" : "Repair Development setup"} in the right-hand Development conversation pane. This retains the saved request; continue it only after the runtime is Ready.`
        : admission?.status === "sending" ? "Development is receiving the saved request. Check its status; do not submit again."
        : admission?.status === "uncertain" ? "Admission is uncertain. Continue checks the exact saved request and submits only if absent and safe. Retired work is never replayed."
            : intent?.status === "starting" && !error ? progress
                : receiptError ? "Saved handoff status is unverified."
                    : canContinue ? "Continue with the saved Prototype in Development. Designer will refine the Design; implementation still needs your confirmation." : "";
    return <Context.Provider value={{ continue: () => void submit(), check: () => void action.run(async () => {
        await refresh(); setCheck(value => value + 1);
    }), busy: action.busy, checking, canContinue, admission, error, status, progress,
        requestId: sameSource ? reference?.requestId ?? null : null }}>
        {children}
    </Context.Provider>;
}

export function useHandoffStatus(active: boolean) {
    const view = useContext(Context);
    const { state } = useUi();
    const { setHandoffStatusOwner } = useProjectView();
    const requestId = active ? view?.requestId ?? null : null;
    useEffect(() => {
        setHandoffStatusOwner(requestId);
        return () => setHandoffStatusOwner(null);
    }, [requestId, setHandoffStatusOwner]);
    const receiptOwnsStatus = view?.admission?.status === "admitted" && typeof view.admission.message === "string"
        && view.admission.message === state.status;
    return { text: active ? view?.progress || "" : "", busy: active && view?.busy === true,
        error: active ? view?.error || "" : "",
        rootStatus: active && receiptOwnsStatus ? "" : state.status };
}

export function HandoffControls({ prototype = false, active = true }: { prototype?: boolean; active?: boolean }) {
    const view = useContext(Context);
    const project = useProjectView();
    const { pending, state } = useUi();
    const hasSnapshot = state.lifecycle.outputs.some(output => output.stageId === "prototype");
    if (!active || !view || !hasSnapshot || !view.status && !view.canContinue && !view.error) return null;
    return <section className="development-handoff-status" aria-label="Prototype handoff">
        {view.status && <Status role="status">{view.status}</Status>}
        {view.canContinue && <Button id={prototype ? "review-prototype-handoff" : "continue-design"} variant="primary"
            disabled={pending || view.busy} onClick={view.continue}>
            {view.admission?.status === "uncertain" ? "Reconcile saved request" : project.active && view.admission?.status === "prepared"
                ? "Continue saved Prototype" : view.error ? "Retry Development" : "Continue to Development"}</Button>}
        {!project.recoveryAction && (view.error || view.admission?.status === "sending") && !view.canContinue && <Button id={prototype ? "check-prototype-handoff" : "check-design-handoff"}
            disabled={view.busy || view.checking} onClick={view.check}>Check handoff status</Button>}
        {!project.recoveryAction && view.error && <Status tone="danger" role="alert">{view.error}</Status>}
    </section>;
}
