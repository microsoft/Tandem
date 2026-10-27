import { useRef, useState } from "react";
import { RefreshCw, RotateCw } from "lucide-react";

import type { PrototypePreviewTarget } from "../prototype-flow.js";
import { prototypePreviewCheckpointId } from "../visual-directions.js";
import type { PreviewStartChoice } from "../preview-start.js";
import { hasActiveJobs, useUi } from "./ui-context.js";
import { Button, Disclosure, FormField, Input, NativeDialog, Select, Textarea, Tooltip } from "./ui/index.js";

interface PreviewRestartInspection {
  needsRecipe: boolean; confirmationId?: string; generation?: string; target: PrototypePreviewTarget; checkpointId: string;
  cwd: string; url: string; executable: string; args?: string[]; workingDirectory?: string; entrypoints?: string[]; message: string;
  choices?: Array<PreviewStartChoice & { id: string }>; notices?: string[];
  environment?: { PORT: string };
}

export function PreviewRestart({ target, unavailable, changed, iconOnly = false }: {
  target: PrototypePreviewTarget; unavailable: boolean; changed(): void; iconOnly?: boolean;
}) {
  const { state, pending, apiUrl } = useUi();
  const [inspection, setInspection] = useState<PreviewRestartInspection | null>(null);
  const [entrypoint, setEntrypoint] = useState(""), [argumentsText, setArgumentsText] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("."), [choiceId, setChoiceId] = useState("");
  const [busy, setBusy] = useState<"inspect" | "start" | "cancel" | null>(null);
  const [error, setError] = useState(""), [status, setStatus] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), inFlight = useRef(false);
  const blocked = pending || state.provider?.canSubmitAnswers === false || hasActiveJobs(state);
  const label = target === "current" ? "current saved preview" : target === "pending" ? "pending saved version"
    : target === "original" ? "original prototype" : target === "exploration" ? "visual exploration"
    : target === "prototype" ? "saved Prototype" : `${target} prototype`;
  const checkpointId = prototypePreviewCheckpointId(state.prototypeFlow, target);
  const stale = Boolean(inspection && (inspection.checkpointId !== checkpointId ||
    inspection.generation && inspection.generation !== state.generation));
  const choices = inspection?.choices ?? [];
  const restartLabel = target === "current" ? "Restart current preview"
    : target === "pending" ? "Restart pending preview" : target === "original" ? "Restart original prototype"
    : target === "exploration" ? "Restart visual exploration" : target === "prototype" ? "Restart Prototype preview" : `Restart ${target} prototype`;
  const buttonLabel = busy === "inspect" ? "Finding start instructions..."
    : busy === "start" ? "Starting preview..." : target === "current" ? "Restart preview" : restartLabel;
  const RestartIcon = iconOnly ? RotateCw : RefreshCw;
  async function request(action: string, body: object): Promise<PreviewRestartInspection & { started?: boolean; alreadyRunning?: boolean }> {
    const endpoint = `/api/prototype/preview-restart/${action}`;
    const response = await fetch(apiUrl?.(endpoint) ?? endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Saved preview restart failed.");
    return value;
  }
  async function inspect(mode: "discover" | "choice" | "manual" = "discover") {
    if (inFlight.current || blocked) return;
    inFlight.current = true; setBusy("inspect"); setError(""); setStatus("");
    try {
      const recipe = mode === "manual" ? { entrypoint: entrypoint.trim(), workingDirectory: workingDirectory.trim() || ".",
        args: argumentsText ? argumentsText.replace(/\r\n/g, "\n").split("\n") : [] } : mode === "choice" ? { choiceId } : {};
      const value = await request("inspect", { target, generation: state.generation, checkpointId, ...recipe });
      setInspection(value);
      if (mode === "discover") {
        const choice = value.choices?.length === 1 ? value.choices[0] : undefined;
        setChoiceId(choice?.id ?? ""); setEntrypoint(choice?.entrypoint ?? "");
        setWorkingDirectory(choice?.workingDirectory ?? "."); setArgumentsText(choice?.args.join("\n") ?? "");
      }
      if (!dialog.current?.open) dialog.current?.showModal();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not find the saved preview's start instructions."); }
    finally { inFlight.current = false; setBusy(null); }
  }
  async function decide(approve: boolean) {
    if (inFlight.current || approve && (blocked || stale)) return;
    const id = inspection?.confirmationId;
    if (!id) { dialog.current?.close(); setInspection(null); return; }
    inFlight.current = true; setBusy(approve ? "start" : "cancel"); setError("");
    if (approve) setStatus("Starting preview. Approve the launch in the owning host if prompted.");
    try {
      const result = await request("decision", { confirmationId: id, approve });
      if (approve) { setStatus(result.alreadyRunning ? "This saved preview is already running." : "The saved preview is running."); changed(); }
      dialog.current?.close(); setInspection(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Restart outcome could not be verified. Retry this same confirmation to reconcile it.");
      setStatus("");
    } finally { inFlight.current = false; setBusy(null); }
  }
  const trigger = <Button variant="secondary" id={`restart-${target}-preview`}
    className={"plan-button secondary" + (iconOnly ? " preview-recovery-action" : "")} type="button"
    aria-label={restartLabel} aria-busy={Boolean(busy)} data-error={unavailable || Boolean(error)}
    disabled={blocked || Boolean(busy)} onClick={() => void inspect()}>
    <RestartIcon size={iconOnly ? 16 : 14} className={iconOnly && busy ? "spin" : undefined} aria-hidden="true" />
    {!iconOnly && buttonLabel}
  </Button>;
  return <div className={"preview-restart" + (iconOnly ? " preview-restart-compact" : "")}>
    {(unavailable || iconOnly) && (iconOnly
      ? <Tooltip.Root><Tooltip.Trigger asChild>{trigger}</Tooltip.Trigger><Tooltip.Portal>
        <Tooltip.Content className="preview-recovery-tooltip" sideOffset={6}>
          <strong>{restartLabel}</strong>
          <p>{error || status || (unavailable ? "The saved preview is unavailable." : "Check the saved server and restart it if needed.")}</p>
          <p>Review the saved server's start instructions before restarting. No rebuild or AI generation.</p>
        </Tooltip.Content>
      </Tooltip.Portal></Tooltip.Root> : trigger)}
    {status && <p className={iconOnly ? "visually-hidden" : undefined} role="status">{status}</p>}
    {error && !dialog.current?.open && <p className={iconOnly ? "visually-hidden" : undefined} role="alert">{error}</p>}
    <NativeDialog ref={dialog} className="preview-restart-dialog" aria-labelledby={`restart-${target}-title`}
      aria-describedby={`restart-${target}-help`} onCancel={event => { event.preventDefault(); if (!busy) void decide(false); }}>
      <h2 id={`restart-${target}-title`}>Restart {label}</h2>
      <p id={`restart-${target}-help`}>{inspection?.message}</p>
      {inspection?.needsRecipe ? <>
        {choices.length > 0 && <form onSubmit={event => { event.preventDefault(); void inspect("choice"); }}>
          <fieldset className="preview-start-choices" disabled={Boolean(busy) || blocked || stale}>
            <legend>{choices.length === 1 ? "Start option found" : "Choose a start option"}</legend>
            {choices.map(choice => <label key={choice.id} className="preview-start-choice">
              <Input type="radio" name={`restart-${target}-choice`} value={choice.id} checked={choiceId === choice.id}
                onChange={() => { setChoiceId(choice.id); setEntrypoint(choice.entrypoint);
                  setWorkingDirectory(choice.workingDirectory); setArgumentsText(choice.args.join("\n")); }} />
              <span><strong>{choice.label}</strong><code>{choice.entrypoint}</code><span className="muted">{choice.detail}</span></span>
            </label>)}
          </fieldset>
          <Button id={`review-${target}-restart`} type="submit" variant="primary" disabled={Boolean(busy) || blocked || stale || !choiceId}>
            Review restart</Button>
        </form>}
        {inspection.notices?.length ? <Disclosure className="preview-start-notices"><summary>Unavailable start options</summary>
          {inspection.notices.map((notice, index) => <p key={index}>{notice}</p>)}</Disclosure> : null}
        <Disclosure className="preview-restart-advanced">
          <summary>Advanced setup</summary>
          <p>Select the Node script that starts the preview server, not an HTML page or a browser component.
            Use the original start instructions if they need arguments. Only files inside this saved preview are allowed.</p>
          <form onSubmit={event => { event.preventDefault(); void inspect("manual"); }}>
            {Boolean(inspection.entrypoints?.length) && <label>Files in this saved preview
              <Select id={`restart-${target}-files`} value={inspection.entrypoints!.includes(entrypoint) ? entrypoint : ""}
                disabled={Boolean(busy) || blocked} onChange={event => setEntrypoint(event.target.value)}>
                <option value="">Select a server file</option>
                {inspection.entrypoints!.map(path => <option key={path} value={path}>{path}</option>)}
              </Select>
            </label>}
            <FormField id={`restart-${target}-entrypoint`} label="Server file">{control =>
              <Input {...control} value={entrypoint} disabled={Boolean(busy) || blocked}
                onChange={event => setEntrypoint(event.target.value)} placeholder="For example: preview\server.mjs" />}</FormField>
            <FormField id={`restart-${target}-directory`} label="Start in folder">{control =>
              <Input {...control} value={workingDirectory} disabled={Boolean(busy) || blocked}
                onChange={event => setWorkingDirectory(event.target.value)} placeholder=". (saved preview folder)" />}</FormField>
            <FormField id={`restart-${target}-arguments`} label="Arguments (one per line)"
              description="Leave empty if the script needs no arguments. Enter each value on its own line; no JSON or shell quoting is needed.">{control =>
              <Textarea {...control} value={argumentsText} rows={3} disabled={Boolean(busy) || blocked}
                onChange={event => setArgumentsText(event.target.value)} placeholder={"--port\n5173"} />}</FormField>
            <Button type="submit" disabled={Boolean(busy) || blocked || stale || !entrypoint.trim()}>Review this setup</Button>
          </form>
        </Disclosure>
      </> : inspection && <>
        <p className="preview-restart-summary"><strong>Saved preview:</strong> {inspection.url}</p>
        <p>Your saved work, feedback and selected design stay unchanged. The owning host may ask permission to start the server.</p>
        <Disclosure className="preview-restart-advanced"><summary>Technical details</summary>
          <dl><dt>Command</dt><dd><code>{[inspection.executable, ...(inspection.args ?? [])].map(part => JSON.stringify(part)).join(" ")}</code></dd>
            <dt>Start in folder</dt><dd>{inspection.workingDirectory ?? inspection.cwd}</dd>
            {inspection.environment && <><dt>Saved server port</dt><dd><code>PORT={inspection.environment.PORT}</code></dd></>}
            <dt>Saved version</dt><dd>{inspection.checkpointId}</dd></dl>
        </Disclosure>
      </>}
      {stale && <p role="alert">The selected saved version changed. Review its start instructions again before restarting.</p>}
      {error && <p role="alert">{error}</p>}
      {(stale || error && inspection?.confirmationId) && <Button
        disabled={Boolean(busy) || blocked} onClick={() => void inspect()}>Review restart again</Button>}
      {busy && <p role="status">{busy === "inspect" ? "Checking the selected start instructions..."
        : busy === "start" ? "Starting the saved preview. Check the owning host for a permission request." : "Closing restart review..."}</p>}
      <div className="preview-restart-actions">
        <Button disabled={Boolean(busy)} onClick={() => void decide(false)}>Cancel</Button>
        {!inspection?.needsRecipe && inspection?.confirmationId && <Button id={`confirm-${target}-restart`}
          variant="primary" disabled={Boolean(busy) || blocked || stale} onClick={() => void decide(true)}>Restart preview</Button>}
      </div>
    </NativeDialog>
  </div>;
}
