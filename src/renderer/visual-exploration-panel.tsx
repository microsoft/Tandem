import { useEffect, useRef, useState } from "react";
import { ExternalLink, Send } from "lucide-react";
import { awaitingVisualChoice, readVisualSelection, visualExplorationIsCurrent, visualPreviewUrl, visualSettingsValues,
  type VisualSelection, type VisualSettings } from "../visual-directions.js";
import { hasActiveJobs, useAction, useDraft, useUi } from "./ui-context.js";
import { PreviewRestart } from "./preview-restart.js";
import { SpeechTextarea } from "./speech-textarea.js";

const settingLabels: Record<keyof VisualSettings, string> = {
  colorMode: "Appearance", accent: "Accent", density: "Density", textSize: "Text size", effects: "Effects",
};
const optionLabel = (value: string) => value === "none" ? "Off" : value.charAt(0).toUpperCase() + value.slice(1);

function VisualFeedback({ checkpointId, selection, name, disabled }: {
  checkpointId: string; selection: VisualSelection; name: string; disabled: boolean;
}) {
  const { state, post } = useUi();
  const action = useAction("visual-feedback");
  const [draft, setDraft] = useDraft("visual-feedback:" + selection.directionId, { value: "", version: 0 });
  const submissions = useRef(new Map<string, string>());
  return <form id="visual-feedback-form" className="visual-feedback inline-composer" onSubmit={event => {
    event.preventDefault();
    if (disabled) return;
    const suggestion = draft.value.trim();
    if (!suggestion || suggestion.length > 4000) { action.setError("Describe a change to this direction in up to 4,000 characters."); return; }
    const key = JSON.stringify([checkpointId, selection, suggestion]), version = draft.version;
    const clientRequestId = submissions.current.get(key) || crypto.randomUUID();
    submissions.current.set(key, clientRequestId);
    void action.run(async () => {
      await post("/api/revision", { suggestion, baseCheckpointId: checkpointId, visualSelection: selection, clientRequestId });
      submissions.current.delete(key);
      setDraft(current => current.version === version ? { value: "", version: version + 1 } : current);
    });
  }}>
    <label htmlFor="visual-feedback-input">Refine {name} only</label>
    <SpeechTextarea id="visual-feedback-input" value={draft.value} rows={1} maxLength={4000}
      disabled={Boolean(state.effortReset)} aria-label={`Feedback for ${name}`} aria-describedby="visual-feedback-status"
      placeholder="Keep this layout, but simplify the toolbar..."
      onValueChange={value => setDraft(current => ({ value, version: current.version + 1 }))} />
    <button id="submit-visual-feedback" type="submit" disabled={disabled}><Send size={14} />
      {action.busy ? "Sending..." : hasActiveJobs(state) ? "Queue refinement" : "Refine direction"}</button>
    <p id="visual-feedback-status" className="revision-status" role="status" data-status={action.error ? "error" : "idle"}>
      {action.error || "This updates the selected alternative, not the current prototype or the other directions."}</p>
  </form>;
}

export function VisualExplorationPanel({ active, connected, inspecting, onInspectChange }: {
  active: boolean; connected: boolean; inspecting: boolean; onInspectChange(value: boolean): void;
}) {
  const { state, post, pending, canEdit } = useUi();
  const action = useAction("visual-exploration");
  const exploration = state.prototypeFlow?.visualExploration;
  const checkpoint = state.prototypeFlow?.checkpoints.find(item => item.id === exploration?.checkpointId);
  const manifest = checkpoint?.visual?.manifest;
  const selection = exploration?.selections.find(item => item.directionId === exploration.activeDirectionId);
  const direction = manifest?.directions.find(item => item.id === selection?.directionId);
  const frame = useRef<HTMLIFrameElement>(null);
  const [refresh, setRefresh] = useState(0), [loaded, setLoaded] = useState(0);
  const [opened, setOpened] = useState(false);
  const [availability, setAvailability] = useState({ binding: "", available: false, busy: false, reason: "" });
  const [bridge, setBridge] = useState({ key: "", ready: false, error: "" });
  const binding = JSON.stringify([state.generation, checkpoint?.id, checkpoint?.previewUrl]);
  const selectionKey = JSON.stringify([binding, selection]);
  const verified = availability.binding === binding && availability.available;
  const current = Boolean(state.prototypeFlow && visualExplorationIsCurrent(state.prototypeFlow));
  const editable = canEdit("prototype") && Boolean(state.prototypeFlow?.visualRequested);
  const finalizing = state.processing?.action === "generate-design-spec" && hasActiveJobs(state);
  const controlsBlocked = pending || !editable || finalizing || Boolean(state.prototypeFlow?.pendingCheckpointId);
  const revisions: Array<{ status: string; visualSelection?: unknown }> = state.prototypeReview.revisions || [];
  const unresolved = revisions.filter(item => !["applied", "dismissed"].includes(item.status));
  const choiceBlocked = controlsBlocked || !current || hasActiveJobs(state) || Boolean(state.prototypeFlow?.pendingCheckpointId)
    || Boolean(state.prototypeReview.question) || unresolved.some(item => item.visualSelection)
    || !inspecting || !verified || bridge.key !== selectionKey || !bridge.ready;
  const activeCheckpoint = state.prototypeFlow?.checkpoints.find(item => item.id === state.prototypeFlow?.activeCheckpointId);
  const refinementBlocked = controlsBlocked || !current || unresolved.length >= 50 ||
    Boolean(activeCheckpoint && activeCheckpoint.visual?.operation !== "refine") ||
    Boolean(state.prototypeFlow && !awaitingVisualChoice(state.prototypeFlow) && unresolved.some(item => !item.visualSelection));
  useEffect(() => { if (inspecting) setOpened(true); }, [inspecting]);

  useEffect(() => {
    if (!active || !connected || !checkpoint?.previewUrl) return;
    const controller = new AbortController(); let mounted = true;
    setAvailability(previous => ({ binding, available: previous.binding === binding && previous.available, busy: true, reason: "" }));
    void (async () => {
      try {
        const response = await fetch("/api/prototype/preview-status?target=exploration", { cache: "no-store", redirect: "error",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]) });
        const value = await response.json();
        if (!response.ok || value.generation !== state.generation || value.checkpointId !== checkpoint.id ||
            value.url !== checkpoint.previewUrl || typeof value.available !== "boolean") {
          throw new Error(value.error || "The visual preview identity changed. Check it again.");
        }
        if (mounted) setAvailability({ binding, available: value.available, busy: false, reason: String(value.reason || "") });
      } catch (error) {
        if (mounted) setAvailability({ binding, available: false, busy: false,
          reason: error instanceof Error ? error.message : "Visual exploration preview is unavailable." });
      }
    })();
    return () => { mounted = false; controller.abort(); };
  }, [active, connected, binding, refresh]);

  useEffect(() => {
    if (!inspecting || !verified || !checkpoint?.previewUrl || !selection) return;
    const source = frame.current?.contentWindow, origin = new URL(checkpoint.previewUrl).origin;
    if (!source) return;
    let requestId = "", timer: number | undefined;
    const send = () => {
      window.clearTimeout(timer);
      requestId = crypto.randomUUID();
      setBridge({ key: selectionKey, ready: false, error: "" });
      try {
        source.postMessage({ type: "tandem:visual:apply", requestId, prototypeId: state.prototypeId,
          checkpointId: checkpoint.id, selection }, origin);
      } catch (error) {
        setBridge({ key: selectionKey, ready: false, error: error instanceof Error ? error.message : "The visual preview could not receive these settings." });
        return;
      }
      timer = window.setTimeout(() => setBridge({ key: selectionKey, ready: false,
        error: "The preview did not confirm these visual controls. Check the preview again; the current prototype is unchanged." }), 5000);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== source || event.source !== frame.current?.contentWindow || event.origin !== origin ||
          event.data?.prototypeId !== state.prototypeId || event.data.checkpointId !== checkpoint.id) return;
      if (event.data.type === "tandem:visual:ready") { send(); return; }
      if (event.data.requestId !== requestId || !["tandem:visual:applied", "tandem:visual:error"].includes(event.data.type)) return;
      window.clearTimeout(timer);
      try {
        if (event.data.type === "tandem:visual:error") throw new Error(String(event.data.error || "Visual settings could not be applied."));
        if (JSON.stringify(readVisualSelection(event.data.selection)) !== JSON.stringify(selection)) {
          throw new Error("The preview confirmed different visual settings. Check it again.");
        }
        setBridge({ key: selectionKey, ready: true, error: "" });
      } catch (error) { setBridge({ key: selectionKey, ready: false, error: error instanceof Error ? error.message : "Invalid visual confirmation." }); }
    };
    window.addEventListener("message", receive);
    send();
    return () => { window.clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [inspecting, verified, selectionKey, loaded, refresh]);

  if (!exploration || !checkpoint || !manifest || !selection || !direction) return null;
  async function select(next: VisualSelection) {
    if (controlsBlocked) return;
    onInspectChange(true);
    await action.run(() => post("/api/prototype/action", { action: "visual-preview", checkpointId: checkpoint!.id,
      selection: next, expectedRevision: state.revision }));
  }
  return <section className="visual-exploration" data-inspecting={inspecting} aria-labelledby="visual-exploration-title">
    <div className="visual-exploration-heading">
      <strong id="visual-exploration-title">Compare visual directions</strong>
      <button id="compare-current-prototype" className="plan-button secondary" type="button" aria-pressed={!inspecting}
        onClick={() => onInspectChange(false)}>Show current prototype</button>
    </div>
    <p id="visual-selection-status" role="status">{inspecting ? `Exploring: ${direction.name}. Not applied to the current prototype.`
      : "Showing the current prototype. Preview a direction to compare; switching is not acceptance."}</p>
    {!current && <p role="status">These alternatives precede the current prototype. Keep them for reference; generate new directions before applying further changes.</p>}
    <div className="visual-direction-cards" role="group" aria-label="Design directions">
      {manifest.directions.map(item => <button key={item.id} id={`visual-direction-${item.id}`} type="button"
        className="visual-direction-card" aria-pressed={inspecting && item.id === selection.directionId}
        disabled={controlsBlocked} onClick={() => void select(exploration.selections.find(choice => choice.directionId === item.id)!)}>
        <strong>{item.name}</strong><span title={item.summary}>{item.summary}</span><span className="visual-card-action">Preview direction</span>
      </button>)}
    </div>
    {inspecting && <>
      <div className="visual-exploration-tools">
        <details id="visual-design-details"><summary>What differs in {direction.name}</summary>
          <dl><dt>Layout</dt><dd>{direction.layout}</dd><dt>Typography</dt><dd>{direction.typography}</dd>
            <dt>Palette</dt><dd>{direction.palette}</dd><dt>Effects</dt><dd>{direction.effects}</dd>
            <dt>Changes from drawings</dt><dd>{direction.sketchChanges}</dd></dl>
        </details>
        <details id="visual-adjustments"><summary>Adjust appearance</summary>
          <div className="visual-settings">
            {(Object.keys(visualSettingsValues) as Array<keyof VisualSettings>).map(key => <label key={key}>
              {settingLabels[key]}<select id={`visual-setting-${key}`} value={selection.settings[key]} disabled={controlsBlocked}
                onChange={event => void select(readVisualSelection({ directionId: selection.directionId,
                  settings: { ...selection.settings, [key]: event.target.value } }))}>
                {visualSettingsValues[key].map(value => <option key={value} value={value}>{optionLabel(value)}</option>)}
              </select>
            </label>)}
          </div>
          <p>Settings are saved separately for each direction. Reduced-motion preferences always turn motion off.</p>
        </details>
        {verified && checkpoint.previewUrl && <a id="open-visual-preview" href={visualPreviewUrl(checkpoint.previewUrl, selection)}
          target="_blank" rel="noreferrer"><ExternalLink size={14} />Open this direction</a>}
        <button id="choose-visual-direction" type="button" className="plan-button" disabled={choiceBlocked}
          aria-describedby="visual-choice-help" onClick={() => void action.run(async () => {
            await post("/api/prototype/action", { action: "choose-visual", checkpointId: checkpoint.id,
              selection, expectedRevision: state.revision });
            onInspectChange(false);
          })}>Prepare this direction</button>
      </div>
      <p id="visual-choice-help">Prepare saves this direction and these settings as application defaults in a new checkpoint. Review it, then explicitly apply it.</p>
    </>}
    {action.error && <p id="visual-action-error" className="revision-status" role="alert" data-status="error">{action.error}</p>}
    {inspecting && (!verified || availability.busy) && <p id="visual-preview-availability" role="status">
      {availability.binding !== binding || availability.busy ? "Checking visual exploration preview..."
        : `Visual exploration preview unavailable. ${availability.reason} Saved directions and settings are preserved.`}</p>}
    {inspecting && <PreviewRestart target="exploration" unavailable={availability.binding === binding && !availability.available && !availability.busy}
      changed={() => setRefresh(value => value + 1)} />}
    {inspecting && <div className="visual-preview-status">
      {bridge.key === selectionKey && bridge.error && <p role="alert">{bridge.error}</p>}
      <button id="check-visual-preview" type="button" className="plan-button secondary" disabled={availability.busy || !connected}
        onClick={() => setRefresh(value => value + 1)}>Check visual preview</button>
    </div>}
    <iframe key={binding} id="visual-preview-frame" ref={frame} title={`Visual direction: ${direction.name}`}
      hidden={!inspecting || !verified} src={verified && opened ? checkpoint.previewUrl || undefined : undefined}
      referrerPolicy="origin" sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
      onLoad={() => setLoaded(value => value + 1)} />
    {inspecting && <VisualFeedback key={direction.id} checkpointId={checkpoint.id} selection={selection} name={direction.name}
      disabled={refinementBlocked} />}
  </section>;
}
