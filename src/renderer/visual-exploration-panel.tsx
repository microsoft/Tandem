import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ExternalLink, RefreshCw } from "lucide-react";
import { ToggleGroup, Tooltip } from "radix-ui";
import { awaitingVisualChoice, originalPrototypeCheckpointId, readVisualSelection, visualExplorationIsCurrent, visualPreviewUrl, visualSettingsValues,
  type VisualSelection, type VisualSettings } from "../visual-directions.js";
import { hasActiveJobs, useAction, useDraft, useUi } from "./ui-context.js";
import { PreviewRestart } from "./preview-restart.js";

const settingLabels: Record<keyof VisualSettings, string> = {
  colorMode: "Appearance", accent: "Accent", density: "Density", textSize: "Text size", effects: "Effects",
};
const optionLabel = (value: string) => value === "none" ? "Off" : value.charAt(0).toUpperCase() + value.slice(1);
const defaultOption = "__default__";
const customOption = "__custom__";

interface VisualAcceptance {
  prototypeId: string;
  generation: string;
  displayedCheckpointId: string | null;
  explorationCheckpointId: string;
  checkpointId: string | null;
  selection: VisualSelection | null;
}

export function VisualExplorationPanel({ active, connected, inspecting, onInspectChange, onApply, defaultPreviewReady, renderActions }: {
  active: boolean; connected: boolean; inspecting: boolean; onInspectChange(value: boolean): void;
  onApply?: (checkpointId: string) => Promise<void>; defaultPreviewReady: boolean;
  renderActions?: (actions: ReactNode) => ReactNode;
}) {
  const { state, post, pending, canEdit, apiUrl } = useUi();
  const previewOwner = state.stageReview?.parentId ?? state.prototypeId;
  const action = useAction("visual-exploration");
  const exploration = state.prototypeFlow?.visualExploration;
  const checkpoint = state.prototypeFlow?.checkpoints.find(item => item.id === exploration?.checkpointId);
  const manifest = checkpoint?.visual?.manifest;
  const selection = exploration?.selections.find(item => item.directionId === exploration.activeDirectionId);
  const direction = manifest?.directions.find(item => item.id === selection?.directionId);
  const displayed = state.prototypeFlow?.checkpoints.find(item => item.id === state.prototypeFlow?.displayedCheckpointId);
  const candidate = state.prototypeFlow?.checkpoints.find(item => item.id === state.prototypeFlow?.pendingCheckpointId);
  const frame = useRef<HTMLIFrameElement>(null);
  const [refresh, setRefresh] = useState(0), [loaded, setLoaded] = useState(0);
  const [opened, setOpened] = useState(false);
  const [availability, setAvailability] = useState({ binding: "", available: false, busy: false, reason: "" });
  const [bridge, setBridge] = useState({ key: "", ready: false, error: "" });
  const [acceptance, setAcceptance] = useState<VisualAcceptance | null>(null);
  const [customDraft, setCustomDraft] = useDraft<VisualSelection | null>(
    "visual-custom:" + JSON.stringify([state.prototypeId, state.generation, checkpoint?.id]), null);
  const applying = useRef<string | null>(null);
  const binding = JSON.stringify([state.generation, checkpoint?.id, checkpoint?.previewUrl]);
  const selectionKey = JSON.stringify([binding, selection]);
  const verified = availability.binding === binding && availability.available;
  const previewUnavailable = availability.binding === binding && !availability.available && !availability.busy;
  const previewError = bridge.key === selectionKey && Boolean(bridge.error);
  const current = Boolean(state.prototypeFlow && visualExplorationIsCurrent(state.prototypeFlow));
  const original = current
    ? state.prototypeFlow?.checkpoints.find(item => item.id === originalPrototypeCheckpointId(state.prototypeFlow))
    : displayed;
  const acceptedVisual = displayed?.visual;
  const acceptedSelection = current && acceptedVisual?.explorationCheckpointId === checkpoint?.id
    && manifest?.directions.some(item => item.id === acceptedVisual?.selection?.directionId) ? acceptedVisual?.selection ?? null : null;
  function optionFor(choice: VisualSelection | null | undefined): string {
    const preset = manifest?.directions.find(item => item.id === choice?.directionId);
    if (!choice || !preset) return "";
    return JSON.stringify(choice.settings) === JSON.stringify(preset.defaults) ? choice.directionId : customOption;
  }
  const appliedDirection = original && original.id === displayed?.id ? defaultOption : optionFor(acceptedSelection);
  const selectedDirection = optionFor(selection);
  const previewIsCustom = selectedDirection === customOption;
  const appliedIsCustom = appliedDirection === customOption;
  const savedCustom = optionFor(customDraft) === customOption ? customDraft : null;
  const customSelection = previewIsCustom ? selection : savedCustom ?? (appliedIsCustom ? acceptedSelection : null);
  const customBase = manifest?.directions.find(item => item.id === customSelection?.directionId);
  const savedOnly = state.lifecycle.completedStages.includes("prototype");
  const previewDirection = inspecting ? selectedDirection : savedOnly ? appliedDirection : defaultOption;
  const selectionChanged = inspecting ? JSON.stringify(selection) !== JSON.stringify(acceptedSelection)
    : !savedOnly && Boolean(original && original.id !== displayed?.id);
  const needsAcceptance = !savedOnly && (selectionChanged ||
    !inspecting && Boolean(state.prototypeFlow && awaitingVisualChoice(state.prototypeFlow)));
  const editable = canEdit("prototype");
  const finalizing = state.processing?.action === "generate-design-spec" && hasActiveJobs(state);
  const savedChoice = candidate?.visual?.operation === "choose" && candidate.visual.explorationCheckpointId === checkpoint?.id;
  const matchingChoice = savedChoice && JSON.stringify(candidate?.visual?.selection) === JSON.stringify(selection);
  const controlsBlocked = pending || !editable || finalizing || Boolean(acceptance)
    || Boolean(state.prototypeFlow?.pendingCheckpointId && !savedChoice);
  const revisions: Array<{ status: string; visualSelection?: unknown }> = state.prototypeReview.revisions || [];
  const unresolved = revisions.filter(item => !["applied", "dismissed"].includes(item.status));
  const choiceBlocked = pending || !editable || finalizing || Boolean(acceptance) || !connected || !current || hasActiveJobs(state)
    || Boolean(state.prototypeFlow?.pendingCheckpointId && !(inspecting && matchingChoice))
    || Boolean(state.prototypeReview.question) || unresolved.some(item => item.visualSelection)
    || inspecting && (!onApply || !verified || bridge.key !== selectionKey || !bridge.ready)
    || !inspecting && (!original || !defaultPreviewReady)
    || !needsAcceptance;
  useEffect(() => { if (inspecting) setOpened(true); }, [inspecting]);
  useEffect(() => { if (savedChoice) onInspectChange(true); }, [candidate?.id, savedChoice]);

  useEffect(() => {
    if (!acceptance?.selection || applying.current || action.busy) return;
    const flow = state.prototypeFlow;
    const target = flow?.checkpoints.find(item => item.id === acceptance.checkpointId);
    const fail = (message: string) => { action.setError(message); setAcceptance(null); };
    if (!active || state.prototypeId !== acceptance.prototypeId || state.generation !== acceptance.generation
      || !flow || flow.displayedCheckpointId !== acceptance.displayedCheckpointId
      || flow.visualExploration?.checkpointId !== acceptance.explorationCheckpointId || !canEdit("prototype")) {
      fail("The prototype changed before acceptance finished. Saved choices are kept; review the current version and accept again.");
      return;
    }
    if (!acceptance.checkpointId) return;
    if (!target || target.generation !== acceptance.generation || target.visual?.operation !== "choose"
      || target.visual.explorationCheckpointId !== acceptance.explorationCheckpointId
      || JSON.stringify(target.visual.selection) !== JSON.stringify(acceptance.selection)) {
      fail("The saved choice no longer matches the selection you accepted. The current prototype is unchanged.");
      return;
    }
    if (target.status === "failed" || target.status === "clarifying") {
      fail(target.summary || "The selected direction could not be applied. Resolve the saved choice, then accept again.");
      return;
    }
    if (target.status !== "ready" || hasActiveJobs(state) || !connected) return;
    if (flow.pendingCheckpointId !== target.id || !onApply) {
      fail("The accepted choice is no longer available to apply. Review the current prototype before retrying.");
      return;
    }
    applying.current = target.id;
    void action.run(async () => {
      try { await onApply(target.id); }
      finally { setAcceptance(null); applying.current = null; }
    });
  }, [state, acceptance, active, connected, action.busy, onApply]);

  useEffect(() => {
    if (!active || !connected || !checkpoint?.previewUrl) return;
    const controller = new AbortController(); let mounted = true;
    setAvailability(previous => ({ binding, available: previous.binding === binding && previous.available, busy: true, reason: "" }));
    void (async () => {
      try {
        const endpoint = "/api/prototype/preview-status?target=exploration";
        const response = await fetch(apiUrl?.(endpoint) ?? endpoint, { cache: "no-store", redirect: "error",
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
        source.postMessage({ type: "tandem:visual:apply", requestId, prototypeId: previewOwner,
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
          event.data?.prototypeId !== previewOwner || event.data.checkpointId !== checkpoint.id) return;
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
  const previewName = previewIsCustom ? "Custom" : direction.name;
  async function comparisonState() {
    const result = savedChoice && candidate
      ? await post("/api/prototype/action", { action: "visual-back", checkpointId: candidate.id, expectedRevision: state.revision }) : state;
    if (result.generation !== state.generation || result.prototypeFlow?.displayedCheckpointId !== state.prototypeFlow?.displayedCheckpointId
      || result.prototypeFlow?.visualExploration?.checkpointId !== checkpoint?.id) {
      throw new Error("The prototype changed. Review its current state before selecting another direction.");
    }
    return result;
  }
  async function showDefault() {
    if (controlsBlocked) return;
    if (!savedChoice) { onInspectChange(false); return; }
    await action.run(async () => { await comparisonState(); onInspectChange(false); });
  }
  async function select(next: VisualSelection) {
    if (controlsBlocked || !checkpoint) return;
    await action.run(async () => {
      const result = await comparisonState();
      await post("/api/prototype/action", { action: "visual-preview", checkpointId: checkpoint.id,
        selection: next, expectedRevision: result.revision });
      if (optionFor(next) === customOption) setCustomDraft(next);
      else if (previewIsCustom && selection) setCustomDraft(selection);
      onInspectChange(true);
    });
  }
  async function accept() {
    if (choiceBlocked || !checkpoint || !selection) return;
    await action.run(async () => {
      const intent: VisualAcceptance = {
        prototypeId: state.prototypeId, generation: state.generation,
        displayedCheckpointId: state.prototypeFlow?.displayedCheckpointId ?? null,
        explorationCheckpointId: checkpoint.id,
        checkpointId: inspecting ? matchingChoice && candidate ? candidate.id : null : original?.id ?? null,
        selection: inspecting ? selection : null,
      };
      setAcceptance(intent);
      try {
        if (!intent.selection) {
          const result = await post("/api/prototype/action", { action: "visual-original",
            checkpointId: intent.checkpointId, expectedRevision: state.revision });
          if (result.generation !== intent.generation || result.prototypeFlow?.displayedCheckpointId !== intent.checkpointId
            || result.prototypeFlow.visualExploration?.checkpointId !== intent.explorationCheckpointId) {
            throw new Error("The original prototype changed before acceptance finished. Review Default before accepting again.");
          }
          setAcceptance(null);
          return;
        }
        if (intent.checkpointId) return;
        const result = await post("/api/prototype/action", { action: "choose-visual", checkpointId: intent.explorationCheckpointId,
          selection: intent.selection, expectedRevision: state.revision });
        const targetId = result.prototypeFlow?.pendingCheckpointId ?? result.prototypeFlow?.activeCheckpointId;
        const target = result.prototypeFlow?.checkpoints.find(item => item.id === targetId);
        if (!target || state.prototypeFlow?.checkpoints.some(item => item.id === target.id)
          || target.visual?.operation !== "choose" || target.visual.explorationCheckpointId !== intent.explorationCheckpointId
          || JSON.stringify(target.visual.selection) !== JSON.stringify(intent.selection)) {
          throw new Error("The selected direction was not saved as the expected choice. The current prototype is unchanged.");
        }
        setAcceptance(current => current === intent ? { ...intent, checkpointId: target.id } : current);
      } catch (error) { setAcceptance(null); throw error; }
    });
  }
  const previewActions = <>
    {inspecting && <Tooltip.Root><Tooltip.Trigger asChild>
      <button id="retry-visual-preview" type="button" className="plan-button secondary preview-recovery-action"
        aria-label="Recheck visual preview" data-error={previewUnavailable || previewError} disabled={availability.busy || !connected}
        onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden="true" /></button>
    </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="preview-recovery-tooltip" sideOffset={6}>
      <strong>Recheck visual preview</strong>{(previewError || availability.reason) && <p>{previewError ? bridge.error : availability.reason}</p>}
      <p>Recheck the saved preview and confirm its settings. Does not rebuild, regenerate, or restart it.</p>
    </Tooltip.Content></Tooltip.Portal></Tooltip.Root>}
    {inspecting && <PreviewRestart target="exploration" unavailable={previewUnavailable}
      changed={() => setRefresh(value => value + 1)} iconOnly />}
    {inspecting && verified && checkpoint.previewUrl && <a id="open-visual-preview" className="plan-button secondary preview-open-action"
      href={visualPreviewUrl(checkpoint.previewUrl, selection)} target="_blank" rel="noreferrer"
      aria-label="Open this direction" title="Open this direction"><ExternalLink size={16} aria-hidden="true" /></a>}
  </>;
  return <>
    {renderActions ? renderActions(previewActions) : <div className="prototype-preview-actions">{previewActions}</div>}
    <section className="visual-exploration" data-inspecting={inspecting} aria-labelledby="visual-exploration-title">
    <div className="visual-exploration-heading">
      <strong id="visual-exploration-title">Compare visual directions</strong>
      <button id="choose-visual-direction" type="button" className="plan-button preview-accept-action" disabled={choiceBlocked}
        aria-describedby="visual-choice-help" aria-busy={Boolean(acceptance)}
        title={!inspecting ? "Accept the original prototype as Default."
          : !onApply ? "Accept is unavailable in this view." : "Apply the previewed direction and settings."}
        onClick={() => void accept()}><Check size={14} aria-hidden="true" />
        {acceptance ? "Accepting..." : "Accept"}</button>
    </div>
    <div className="visual-selection-toolbar">
      <ToggleGroup.Root className="visual-direction-toggles" type="single" aria-label="Design directions"
        value={previewDirection} disabled={controlsBlocked}
        onValueChange={value => {
          if (!value) return;
          if (value === defaultOption) { void showDefault(); return; }
          if (value === customOption) { if (customSelection) void select(customSelection); return; }
          const preset = manifest.directions.find(item => item.id === value);
          if (preset) void select(readVisualSelection({ directionId: preset.id, settings: preset.defaults }));
        }}>
        <Tooltip.Root><Tooltip.Trigger asChild>
          <ToggleGroup.Item id="compare-current-prototype" className="visual-direction-toggle" type="button" value={defaultOption}
            disabled={!original}
            data-applied={appliedDirection === defaultOption} data-preview={selectionChanged && previewDirection === defaultOption}
            aria-current={appliedDirection === defaultOption ? "true" : undefined}
            aria-description={appliedDirection === defaultOption ? "Applied direction" : previewDirection === defaultOption ? "Previewing direction" : undefined}>
            Default
          </ToggleGroup.Item>
        </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="visual-direction-tooltip" sideOffset={6}>
          <strong>Default: original prototype</strong>
          <p>{current ? "The exact saved prototype from before visual exploration, with its original layout, styling and interactions."
            : "The current prototype. These saved alternatives precede its latest changes."}</p>
          <p>Previewing Default does not change the accepted version. Use Accept to restore the original.</p>
        </Tooltip.Content></Tooltip.Portal></Tooltip.Root>
        {manifest.directions.map(item => <Tooltip.Root key={item.id}><Tooltip.Trigger asChild>
          <ToggleGroup.Item id={`visual-direction-${item.id}`} className="visual-direction-toggle" type="button" value={item.id}
            data-applied={appliedDirection === item.id} data-preview={selectionChanged && previewDirection === item.id}
            aria-current={appliedDirection === item.id ? "true" : undefined}
            aria-description={appliedDirection === item.id ? "Applied direction" : previewDirection === item.id ? "Previewing direction" : undefined}>
            {item.name}
          </ToggleGroup.Item>
        </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="visual-direction-tooltip" sideOffset={6}>
          <strong>{item.name}</strong><p>{item.summary}</p>
          <dl><dt>Layout</dt><dd>{item.layout}</dd><dt>Typography</dt><dd>{item.typography}</dd>
            <dt>Palette</dt><dd>{item.palette}</dd><dt>Effects</dt><dd>{item.effects}</dd>
            <dt>Changes from designs</dt><dd>{item.sketchChanges}</dd></dl>
        </Tooltip.Content></Tooltip.Portal></Tooltip.Root>)}
        {customSelection && customBase && <Tooltip.Root><Tooltip.Trigger asChild>
          <ToggleGroup.Item id="visual-custom-direction" className="visual-direction-toggle" type="button" value={customOption}
            data-applied={appliedIsCustom} data-preview={selectionChanged && previewDirection === customOption}
            aria-current={appliedIsCustom ? "true" : undefined}
            aria-description={appliedIsCustom
              ? previewDirection === customOption && selectionChanged ? "Applied custom direction; previewing changed settings" : "Applied custom direction"
              : previewDirection === customOption ? "Previewing custom direction" : undefined}>
            Custom
          </ToggleGroup.Item>
        </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="visual-direction-tooltip" sideOffset={6}>
          <strong>Custom</strong><p>Modified appearance settings on the {customBase.name} layout.</p>
          <dl>{(Object.keys(visualSettingsValues) as Array<keyof VisualSettings>).map(key => <Fragment key={key}>
            <dt>{settingLabels[key]}</dt><dd>{optionLabel(customSelection.settings[key])}</dd>
          </Fragment>)}</dl>
        </Tooltip.Content></Tooltip.Portal></Tooltip.Root>}
      </ToggleGroup.Root>
    </div>
    <p id="visual-selection-status" className={needsAcceptance || acceptance ? "muted" : "visually-hidden"} role="status">{acceptance
      ? acceptance.selection ? "Applying the accepted direction. The current prototype stays available." : "Restoring the original prototype."
      : inspecting ? selectionChanged ? `Previewing ${previewName}. Accept to apply.` : `Accepted: ${previewName}.`
      : savedOnly ? "Showing the saved accepted prototype."
      : needsAcceptance && !selectionChanged ? "Showing Default (original prototype). Accept to keep it."
      : selectionChanged ? "Previewing Default (original prototype). Accept to apply." : "Showing Default (original prototype)."}</p>
    <p id="visual-choice-help" className="visually-hidden">Default shows the original prototype. Solid fill marks the applied direction. A blue border marks an unapplied preview. Accept applies the previewed original, direction or appearance settings; previewing alone never changes the accepted prototype.</p>
    {!original && <p role="alert">The original prototype snapshot is unavailable. Saved directions and settings are preserved.</p>}
    {!current && <p role="status">These alternatives precede the current prototype. Keep them for reference; generate new directions before applying further changes.</p>}
    {inspecting && <>
      <div className="visual-exploration-tools">
        <details id="visual-adjustments"><summary>Advanced settings</summary>
          <div className="visual-settings">
            {(Object.keys(visualSettingsValues) as Array<keyof VisualSettings>).map(key => <label key={key}>
              {settingLabels[key]}<select id={`visual-setting-${key}`} value={selection.settings[key]} disabled={controlsBlocked}
                onChange={event => void select(readVisualSelection({ directionId: selection.directionId,
                  settings: { ...selection.settings, [key]: event.target.value } }))}>
                {visualSettingsValues[key].map(value => <option key={value} value={value}>{optionLabel(value)}</option>)}
              </select>
            </label>)}
          </div>
          <p>Changes appear as Custom. Reduced-motion preferences always turn motion off.</p>
        </details>
      </div>
    </>}
    {action.error && <p id="visual-action-error" className="revision-status" role="alert" data-status="error">{action.error}</p>}
    {inspecting && (!verified || availability.busy) && <p id="visual-preview-availability"
      className={previewUnavailable ? "revision-status" : "visually-hidden"} role="status" data-status={previewUnavailable ? "error" : "idle"}>
      {availability.binding !== binding || availability.busy ? "Checking visual exploration preview..."
        : `Visual exploration preview unavailable. ${availability.reason} Use the toolbar to recheck or restart it. Saved directions and settings are preserved.`}</p>}
    {inspecting && previewError && <p className="revision-status" role="alert" data-status="error">{bridge.error}</p>}
    <iframe key={binding} id="visual-preview-frame" ref={frame} title={`Visual direction: ${previewName}`}
      hidden={!inspecting || !verified} src={verified && opened ? checkpoint.previewUrl || undefined : undefined}
      referrerPolicy="origin" sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
      onLoad={() => setLoaded(value => value + 1)} />
    </section>
  </>;
}
