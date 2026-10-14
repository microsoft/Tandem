import { useEffect, useRef, useState } from "react";
import { AlertDialog } from "radix-ui";
import type { DevelopmentGitPreflight } from "../development-git.js";

async function check(): Promise<DevelopmentGitPreflight> {
    const response = await fetch("/api/development/preflight", { cache: "no-store" });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Development readiness could not be checked.");
    if (!["ready", "setup", "blocked"].includes(value.status) || typeof value.projectPath !== "string"
        || typeof value.message !== "string" || (value.status === "setup" && typeof value.token !== "string")) {
        throw new Error("Invalid Development readiness response. No setup was performed.");
    }
    return value;
}

export function useDevelopmentGit() {
    const [view, setView] = useState<{ result: DevelopmentGitPreflight | null; busy: boolean; error: string } | null>(null);
    const pending = useRef<((ready: boolean) => void) | null>(null);
    const checking = useRef(false);
    const acting = useRef(false);
    useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);
    function finish(ready: boolean) {
        pending.current?.(ready);
        pending.current = null;
        setView(null);
    }
    async function requireReady(): Promise<boolean> {
        if (checking.current || pending.current) return false;
        checking.current = true;
        try {
            let result: DevelopmentGitPreflight | null = null, error = "";
            try { result = await check(); } catch (failure) { error = failure instanceof Error ? failure.message : "Readiness check failed."; }
            if (result?.status === "ready") return true;
            return await new Promise<boolean>(resolve => {
                pending.current = resolve;
                setView({ result, busy: false, error });
            });
        } finally { checking.current = false; }
    }
    async function act(setup: boolean) {
        if (acting.current) return;
        acting.current = true;
        setView(v => v && ({ ...v, busy: true, error: "" }));
        try {
            if (setup) {
                const response = await fetch("/api/development/setup", { method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token: view?.result?.token }) });
                const value = await response.json();
                if (!response.ok) throw new Error(value.error || "Git setup did not finish.");
            }
            const result = await check();
            if (result.status === "ready") finish(true);
            else setView({ result, busy: false, error: "" });
        } catch (error) {
            // A failed consent cannot be replayed as a fresh attempt; require another read.
            setView(v => v && ({ result: v.result && { ...v.result, status: "blocked" }, busy: false,
                error: error instanceof Error ? error.message : "Git setup did not finish. Check the folder before retrying." }));
        } finally { acting.current = false; }
    }
    const dialog = <AlertDialog.Root open={view !== null}>
        <AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay" /><AlertDialog.Content className="dialog-content project-entry">
            <AlertDialog.Title>Set up this project folder</AlertDialog.Title>
            <AlertDialog.Description>
                <span className="project-entry-path">{view?.result?.projectPath}</span>
                {view?.result?.message}
            </AlertDialog.Description>
            <p>Existing files and ignore rules are preserved. Setup does not create a commit, configure a remote, push, submit a model request or approve implementation.</p>
            {view?.error && <p role="alert">{view.error}</p>}
            {view?.busy && <p role="status">Checking and preparing this folder...</p>}
            <div className="dialog-actions">
                <button id="cancel-git-setup" type="button" className="plan-button secondary" disabled={view?.busy}
                    onClick={() => finish(false)}>Cancel</button>
                {view?.result?.status === "setup" && <button id="confirm-git-setup" type="button" className="plan-button" disabled={view.busy}
                    onClick={() => void act(true)}>Set up this folder and continue</button>}
                {view?.result?.status !== "setup" && <button id="retry-git-preflight" type="button" className="plan-button" disabled={view?.busy}
                    onClick={() => void act(false)}>Check again</button>}
            </div>
        </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>;
    return { requireReady, visible: view !== null, dialog };
}
