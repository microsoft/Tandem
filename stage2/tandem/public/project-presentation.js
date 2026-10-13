import { projectOutputs } from "./project-outputs.js";

// Presentation messages never become native conversation input or runtime authority.
export function installProjectPresentation({ document, window, changed, settings, currentWork, effortChanged, layoutChanged, openOutput, outputSelection, hasAttachments = () => false }) {
  const { projectPanel: panel, projectOrigin: origin, projectChannel: channel } = document.body.dataset;
  if (!panel) return null;
  let context = null, draftContext = null, pending = null, nativePending = false;
  let currentSnapshot = null;
  const send = value => window.parent.postMessage({ protocol: "tandem-project/v1", channel, ...value }, origin);
  const effortPanel = document.querySelector("#project-effort-settings");
  const effort = document.querySelector("#project-effort"), effortApply = document.querySelector("#apply-project-effort");
  const effortRefresh = document.querySelector("#refresh-project-effort"), effortStatus = document.querySelector("#project-effort-status");
  const effortError = document.querySelector("#project-effort-error");
  const reloadPanel = document.querySelector("#project-provider-maintenance");
  const reloadButton = document.querySelector("#project-reload-extension");
  const reloadPurpose = document.querySelector("#project-reload-purpose"), reloadStatus = document.querySelector("#project-reload-status");
  let reloadPending = null, reloadError = "";
  const validReload = value => value && ["supported", "disabled", "error"].every(key => typeof value[key] === "boolean")
    && typeof value.scope === "string" && value.scope.length <= 1024
    && typeof value.label === "string" && value.label.length <= 100
    && typeof value.title === "string" && value.title.length <= 2000
    && typeof value.message === "string" && value.message.length <= 8192;
  function renderReload() {
    if (!reloadPanel) return;
    const view = context?.providerReload, valid = validReload(view);
    reloadPanel.hidden = !valid || !view.supported && !view.message && !reloadError;
    reloadButton.hidden = !valid || !view.supported;
    reloadButton.disabled = !valid || view.disabled || Boolean(reloadPending);
    if (valid) {
      reloadButton.textContent = view.label;
      reloadPurpose.textContent = view.title;
      reloadStatus.textContent = reloadError || view.message;
    }
  }
  if (reloadButton) reloadButton.onclick = () => {
    const view = context?.providerReload;
    if (!validReload(view) || !view.supported || view.disabled || reloadPending) return;
    reloadPending = crypto.randomUUID(); reloadError = ""; renderReload();
    send({ type: "project-reload", id: reloadPending, scope: view.scope });
  };
  let effortPending = null;
  if (effortPanel) {
    effortPanel.hidden = false;
    document.querySelector("#private-effort-setting").hidden = true;
  }
  const validStage = value => value && ["desired", "actual", "model", "error"].every(key => value[key] === null || typeof value[key] === "string")
    && typeof value.status === "string" && Array.isArray(value.supported) && value.supported.every(level => typeof level === "string");
  function renderEffort() {
    if (!effortPanel) return;
    const blocked = Boolean(effortPending) || context?.canChangeEffort !== true;
    effort.disabled = blocked;
    effortApply.disabled = blocked || !effort.value;
    effortRefresh.disabled = Boolean(effortPending);
    effortPanel.setAttribute("aria-busy", String(Boolean(effortPending)));
  }
  function requestEffort(apply = false) {
    if (!effortPanel || effortPending || apply && (context?.canChangeEffort !== true || !effort.value)) return;
    effortPending = crypto.randomUUID();
    effortError.hidden = true;
    renderEffort(); changed();
    send({ type: apply ? "project-effort-apply" : "project-effort-read", id: effortPending, ...(apply ? { effort: effort.value } : {}) });
  }
  if (effortPanel) {
    effort.onchange = renderEffort;
    effortApply.onclick = () => requestEffort(true);
    effortRefresh.onclick = () => requestEffort();
  }
  const controls = document.createElement("div");
  controls.id = "project-message-context";
  const label = document.createElement("strong");
  const help = document.createElement("p");
  const returnToDraft = document.createElement("button");
  returnToDraft.type = "button"; returnToDraft.id = "return-draft-context";
  returnToDraft.onclick = () => send({ type: "view-stage", stage: draftContext?.stage });
  const useHere = document.createElement("button");
  useHere.type = "button"; useHere.id = "use-draft-here";
  useHere.onclick = () => {
    if (pending || nativePending || hasAttachments() && liveContext()?.stage !== "development") return;
    draftContext = liveContext(); update(); changed();
  };
  const check = document.createElement("button");
  check.type = "button"; check.textContent = "Check submission";
  check.onclick = () => { if (pending) send({ type: "discovery-status", id: pending.id }); };
  controls.append(label, help, returnToDraft, useHere, check);
  document.querySelector("#composer").prepend(controls);
  const liveContext = () => context && ({ stage: context.viewedStage ?? (context.designVisible ? "development" : context.discovery.stage ?? "requirements"),
    label: context.viewLabel ?? (context.designVisible ? "Development" : context.discovery.label), discovery: context.discovery });
  const hasDraft = () => Boolean(document.querySelector("#message").value.trim()) || hasAttachments();
  const captureDraft = () => { if (!draftContext && (hasDraft() || pending || nativePending)) draftContext = liveContext(); };
  const current = () => draftContext ?? liveContext();
  const conflicted = () => Boolean(draftContext && context && (draftContext.stage !== liveContext().stage
    || draftContext.stage !== "development" && draftContext.discovery.key !== context.discovery.key));
  const update = () => {
    if (!hasDraft() && !pending && !nativePending) draftContext = null;
    captureDraft();
    label.textContent = current()?.label ?? "Project conversation";
    help.textContent = conflicted() ? `This draft belongs to ${draftContext.label}. Return there, or explicitly use it in ${liveContext().label}.`
      : current()?.stage === "development" ? context?.starting ? "Starting Development..." : "Discuss Design or request work. Implementation requires separate confirmation."
        : context?.discovery?.help ?? "Waiting for the project workspace.";
    returnToDraft.hidden = !conflicted();
    returnToDraft.textContent = `Return to ${draftContext?.label ?? "draft"}`;
    useHere.hidden = !conflicted() || hasAttachments() && liveContext()?.stage !== "development";
    useHere.textContent = `Use draft in ${liveContext()?.label ?? "this view"}`;
    returnToDraft.disabled = Boolean(pending) || nativePending;
    useHere.disabled = Boolean(pending) || nativePending;
    check.hidden = !pending;
    if (pending) help.textContent = "Awaiting the exact discovery action result. Check submission reads that same result; it never sends another action.";
  };
  document.querySelector("#message").addEventListener("input", () => { captureDraft(); update(); changed(); });
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.origin !== origin || event.data?.protocol !== "tandem-project/v1"
      || event.data.channel !== channel) return;
    const message = event.data;
    if (message.type === "context" && Array.isArray(message.entries) && message.entries.length <= 1000
      && message.entries.every(entry => typeof entry.id === "string" && entry.id.startsWith("discovery:")
        && ["user", "status"].includes(entry.kind) && typeof entry.text === "string" && entry.text.length <= 20000
        && typeof entry.timestamp === "string" && Number.isFinite(Date.parse(entry.timestamp)))
      && typeof message.discovery?.key === "string" && message.discovery.key.length <= 2000
      && typeof message.discovery?.label === "string" && message.discovery.label.length <= 200
      && typeof message.discovery?.help === "string" && message.discovery.help.length <= 2000
      && typeof message.discovery.enabled === "boolean") {
      captureDraft();
      context = message;
      document.body.dataset.projectDesign = String(message.designVisible === true);
      document.body.dataset.projectWorking = message.developmentEntered === true ? "development" : "discovery";
      renderEffort();
      renderReload();
      update(); changed();
    } else if (message.type === "layout" && typeof message.stacked === "boolean"
      && Number.isFinite(message.conversationWidth) && message.conversationWidth >= 0 && message.conversationWidth <= 20000) {
      document.body.dataset.projectStacked = String(message.stacked);
      layoutChanged?.({ stacked: message.stacked, conversationWidth: message.conversationWidth });
    } else if (message.type === "output-open" && typeof message.id === "string" && typeof message.binding === "string") {
      try {
        const catalog = projectOutputs(currentSnapshot);
        const item = catalog.items.find(item => item.id === message.id && item.binding === message.binding);
        if (catalog.status !== "verified" || !item || !openOutput) throw new Error("This output is no longer verified at the selected binding. Refresh its original view.");
        openOutput(item, currentSnapshot);
        send({ type: "output-opened", id: item.id, binding: item.binding });
      } catch (error) { send({ type: "output-opened", id: message.id, error: error.message }); }
    } else if (message.type === "command") {
      if (message.command === "settings") { settings(); requestEffort(); }
      if (message.command === "current-work") currentWork();
    } else if (message.type === "project-reload-result" && reloadPending === message.id) {
      reloadPending = null;
      reloadError = typeof message.error === "string" ? message.error
        : message.accepted === true ? "" : "Provider reload was not confirmed. Inspect project status before retrying.";
      renderReload();
    } else if (message.type === "project-effort-result" && effortPending === message.id) {
      effortPending = null;
      const value = message.settings;
      let error = typeof message.error === "string" ? message.error : "";
      if (value !== undefined) {
        if (!value || !validStage(value.stage1) || !validStage(value.stage2)
          || value.desired !== null && typeof value.desired !== "string") error = "Project effort readback is invalid.";
        else {
          const available = value.stage1.supported.length ? value.stage1.supported : value.stage2.supported;
          const levels = value.stage2.model && value.stage2.supported.length
            ? available.filter(level => value.stage2.supported.includes(level)) : available;
          effort.replaceChildren();
          for (const level of ["", ...levels]) {
            const option = document.createElement("option"); option.value = level;
            option.textContent = level || "No shared choice; native defaults unchanged"; option.disabled = !level; effort.append(option);
          }
          effort.value = value.desired ?? "";
          effortStatus.replaceChildren(...[value.stage1, value.stage2].map((stage, index) => {
            const row = document.createElement("p");
            row.textContent = `Stage ${index + 1}: ${stage.status}. Actual: ${stage.actual || "not yet available"}.`
              + (stage.model ? ` Model: ${stage.model}.` : "") + (stage.error ? ` ${stage.error}` : "");
            return row;
          }));
        }
      } else if (!error) error = "Project effort readback is unavailable.";
      effortError.textContent = error; effortError.hidden = !error;
      renderEffort(); changed();
      effortChanged?.();
    } else if (message.type === "discovery-result" && pending?.id === message.id) {
      const work = pending; pending = null; update();
      if (message.ok === true) work.resolve();
      else work.reject(new Error(typeof message.error === "string" ? message.error : "Discovery submission was not confirmed."));
    } else if (message.type === "discovery-unknown" && pending?.id === message.id) {
      help.textContent = "This workspace cannot confirm the submission. Inspect saved state before reopening; your draft is retained and nothing was resent.";
    }
  });
  update();
  send({ type: "ready", panel });
  return {
    panel,
    activate: retry => send({ type: "activate", retry: retry === true }),
    showDesign: () => send({ type: "show-design" }),
    settingsClosed: () => send({ type: "settings-closed" }),
    unavailable(reason) {
      currentSnapshot = null;
      send({ type: "outputs", status: "unverified", reason: `Development connection unavailable. Last observed outputs are retained: ${reason}`, items: [] });
    },
    appearance: preferences => send({ type: "appearance", theme: preferences.theme, fontSize: preferences.fontSize }),
    resized: width => send({ type: "conversation-resize", width }),
    busy: () => Boolean(effortPending),
    nativePending(value) { nativePending = value; update(); },
    discovery: () => current()?.stage !== "development",
    developmentEnabled: () => context?.developmentEnabled === true && !context?.starting,
    workingDevelopment: () => context?.developmentEntered === true,
    placeholder: () => conflicted() ? `Draft for ${draftContext.label}`
      : current()?.stage === "development" ? "Ask about the Design, or describe the work you want."
        : ({ goal: "Describe your project goal.", usage: "Describe a requirement usage.", sketch: "Describe a drawing revision.", prototype: "Describe prototype feedback." }[context?.discovery?.action] ?? "Use this phase's controls to continue."),
    canSend: () => !pending && !conflicted() && (current()?.stage === "development" || context?.discovery?.enabled === true),
    entries: () => [],
    submit(text) {
      if (!context?.discovery?.enabled || pending || conflicted()) return Promise.reject(new Error("This phase action is not available for the retained draft."));
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        pending = { id, resolve, reject }; update();
        send({ type: "discovery-send", id, text, key: current().discovery.key });
      });
    },
    publish(snapshot) {
      currentSnapshot = snapshot;
      const catalog = projectOutputs(snapshot);
      const selection = outputSelection?.();
      send({ type: "outputs", status: catalog.status, reason: catalog.reason,
        items: catalog.items.map(({ target, ...item }) => item),
        selected: catalog.items.find(item => item.id === selection?.id && item.binding === selection?.binding)?.id ?? null });
      send({ type: "status", status: snapshot.workflow?.status ?? snapshot.installation?.status ?? "unavailable",
        installationStatus: snapshot.installation?.status,
        canRetry: snapshot.installation?.canRetry === true, canReopen: snapshot.installation?.canReopen === true,
        active: snapshot.installation?.status === "ready",
        role: snapshot.workflow?.activeRole ?? null, reason: snapshot.workflow?.reason ?? snapshot.installation?.reason ?? null,
        designRevision: snapshot.design?.binding?.revisionId ?? null,
        questions: snapshot.workflow?.questionCounts?.unanswered ?? 0, permissions: snapshot.accessRequests?.length ?? 0,
        confirmations: snapshot.workflow?.implementationConfirmations?.filter(item => item.status === "pending").length ?? 0 });
    },
  };
}
