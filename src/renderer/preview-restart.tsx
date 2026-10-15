import { useRef, useState } from "react";
import type { PrototypePreviewTarget } from "../prototype-flow.js";
import { hasActiveJobs, useUi } from "./ui-context.js";

interface PreviewRestartInspection {
  needsRecipe: boolean; confirmationId?: string; target: PrototypePreviewTarget; checkpointId: string;
  cwd: string; url: string; executable: string; args?: string[]; entrypoints?: string[]; message: string;
}

export function PreviewRestart({ target, unavailable, changed }: { target: PrototypePreviewTarget; unavailable: boolean; changed(): void }) {
  const { state, pending } = useUi();
  const [inspection, setInspection] = useState<PreviewRestartInspection | null>(null);
  const [entrypoint, setEntrypoint] = useState(""), [argumentsText, setArgumentsText] = useState("[]");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const blocked = pending || state.provider?.canSubmitAnswers === false || hasActiveJobs(state);
  const label = target === "current" ? "current saved preview" : target === "pending" ? "pending saved version" : "visual exploration";
  async function request(action: string, body: object): Promise<PreviewRestartInspection & { started?: boolean; alreadyRunning?: boolean }> {
    const response = await fetch(`/api/prototype/preview-restart/${action}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Saved preview restart failed.");
    return value;
  }
  async function inspect(recipe = false) {
    if (busy || blocked) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const args: unknown = JSON.parse(argumentsText);
      if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new Error("Arguments must be a JSON array of strings.");
      const value = await request("inspect", { target, generation: state.generation,
        checkpointId: target === "current" ? state.prototypeFlow?.displayedCheckpointId
          : target === "pending" ? state.prototypeFlow?.pendingCheckpointId : state.prototypeFlow?.visualExploration?.checkpointId,
        ...(recipe ? { entrypoint, args } : {}) });
      setInspection(value);
      if (!dialog.current?.open) dialog.current?.showModal();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not inspect the saved preview launch."); }
    finally { setBusy(false); }
  }
  async function decide(approve: boolean) {
    const id = inspection?.confirmationId;
    if (busy) return;
    if (!id) { dialog.current?.close(); setInspection(null); return; }
    setBusy(true); setError("");
    if (approve) setStatus("Starting saved preview. Complete any native permission request in the owning session.");
    try {
      const result = await request("decision", { confirmationId: id, approve });
      if (approve) { setStatus(result.alreadyRunning ? "The selected preview is already running and verified." : "The selected saved preview is running and verified."); changed(); }
      dialog.current?.close(); setInspection(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Restart outcome could not be verified. Retry this same confirmation to reconcile it.");
      setStatus("");
    } finally { setBusy(false); }
  }
  return <div className="preview-restart">
    {unavailable && <button id={`restart-${target}-preview`} className="plan-button secondary" type="button" disabled={blocked || busy}
      onClick={() => void inspect()}>{busy ? "Starting preview..." : target === "current" ? "Restart preview"
        : target === "pending" ? "Restart pending preview" : "Restart visual exploration"}</button>}
    {status && <p role="status">{status}</p>}
    {error && !dialog.current?.open && <p role="alert">{error}</p>}
    <dialog ref={dialog} className="preview-restart-dialog" aria-labelledby={`restart-${target}-title`}
      onCancel={event => { event.preventDefault(); if (!busy) void decide(false); }}>
      <h2 id={`restart-${target}-title`}>Restart {label}</h2>
      <p>{inspection?.message}</p>
      {inspection?.needsRecipe ? <form onSubmit={event => { event.preventDefault(); void inspect(true); }}>
        <p>This adapter runs an existing Node entrypoint only. Other stacks need an explicitly supported launch adapter; no default script is substituted.</p>
        <label>Saved Node entrypoint<input id={`restart-${target}-entrypoint`} list={`restart-${target}-files`} value={entrypoint}
          onChange={event => setEntrypoint(event.target.value)} placeholder="Choose or enter the existing file path" /></label>
        <datalist id={`restart-${target}-files`}>{inspection.entrypoints?.map(path => <option key={path} value={path} />)}</datalist>
        <details><summary>Additional arguments</summary><label>Arguments (JSON array)<textarea value={argumentsText} onChange={event => setArgumentsText(event.target.value)} /></label></details>
        <button type="submit" disabled={busy || !entrypoint.trim()}>Review launch</button>
      </form> : <pre>{inspection && `${inspection.executable}\n${JSON.stringify(inspection.args)}\nWorking directory: ${inspection.cwd}\nSaved URL: ${inspection.url}\nCheckpoint: ${inspection.checkpointId}`}</pre>}
      {error && <p role="alert">{error}</p>}
      {error && inspection?.confirmationId && <button type="button" disabled={busy} onClick={() => void inspect()}>Review a new restart attempt</button>}
      {busy && <p role="status">Starting the selected saved version. Native permission may be waiting in the owning host.</p>}
      <button type="button" disabled={busy} onClick={() => void decide(false)}>Cancel</button>
      {!inspection?.needsRecipe && inspection?.confirmationId && <button id={`confirm-${target}-restart`} type="button" disabled={busy} onClick={() => void decide(true)}>Restart this saved version</button>}
    </dialog>
  </div>;
}
