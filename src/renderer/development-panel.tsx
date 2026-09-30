import { useEffect, useRef, useState } from "react";
import { useAction, useUi } from "./ui-context.js";
import { ProcessPanel } from "./process-panel.js";

export function DevelopmentPanel({ active }: { active: boolean }) {
    const { state, post, refresh } = useUi();
    const action = useAction("development");
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState("");
    const opening = useRef(false);
    const eligible = state.lifecycle.currentStage === "development" && state.provider?.canSubmitAnswers !== false;
    const snapshot = state.lifecycle.outputs.find(output => output.stageId === "prototype");
    const open = async () => {
        if (opening.current || url || !eligible) return;
        opening.current = true;
        setError("");
        try {
            const response = await fetch("/api/development/open", { method: "POST",
                headers: { "Content-Type": "application/json" }, body: "{}" });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error || "Development could not open.");
            const target = new URL(value.url);
            if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.origin === location.origin) {
                throw new Error("Development did not return its isolated loopback origin.");
            }
            setUrl(target.href);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Development could not open."); }
        finally { opening.current = false; }
    };
    useEffect(() => { if (active) void open(); }, [active, eligible]);
    if (!eligible && !url) return <div className="development-empty">Complete Prototype to open Development.</div>;
    return <div className="development-workspace">
        <div className="development-toolbar">
            <span>Design, implementation and Review share one private session. Opening this view sends no project request.</span>
            {snapshot && <button id="continue-design" type="button" className="plan-button"
                disabled={!eligible || action.busy || Boolean(state.developmentBlocker)}
                onClick={() => void action.run(async () => {
                    await post("/api/development/continue", { generation: state.generation,
                        expectedRevision: state.revision, snapshotPath: snapshot.path }, 120000);
                    await refresh();
                })}>{state.development ? "Reconcile Design handoff" : "Continue Design from Prototype"}</button>}
            <details className="development-process"><summary>Acceptance and delivery</summary>{active && <ProcessPanel />}</details>
        </div>
        {(error || action.error || state.developmentBlocker) && <div role="alert" className="development-error">
            {error || action.error || state.developmentBlocker}
            {error && <button type="button" onClick={() => void open()}>Retry opening</button>}
        </div>}
        {state.development && <p className="development-provenance">Retained handoff: {state.development.handoffId}.
            Reconciliation never replays retired work. Use a new explicit message in Development to continue after recovery.</p>}
        {url ? <iframe id="development-frame" className="development-frame" title="Tandem Development"
            src={url} allow="clipboard-read; clipboard-write" /> : <p role="status">Opening the owned Development workspace...</p>}
    </div>;
}
