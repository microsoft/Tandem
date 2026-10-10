// Presentation messages never become native conversation input or runtime authority.
export function installProjectPresentation({ document, window, changed, settings, currentWork }) {
  const { projectPanel: panel, projectOrigin: origin, projectChannel: channel } = document.body.dataset;
  if (!panel) return null;
  let context = null, selected = "discovery", pending = null, nativePending = false;
  const send = value => window.parent.postMessage({ protocol: "tandem-project/v1", channel, ...value }, origin);
  const controls = document.createElement("div");
  controls.id = "project-message-context";
  const label = document.createElement("label");
  label.textContent = "Send to ";
  const target = document.createElement("select");
  target.id = "project-message-target";
  label.append(target);
  const help = document.createElement("p");
  const activate = document.createElement("button");
  activate.type = "button"; activate.id = "activate-project-development";
  activate.textContent = "Activate Development";
  activate.onclick = () => send({ type: "activate" });
  const check = document.createElement("button");
  check.type = "button"; check.textContent = "Check submission";
  check.onclick = () => { if (pending) send({ type: "discovery-status", id: pending.id }); };
  controls.append(label, help, activate, check);
  document.querySelector("#composer").prepend(controls);
  const update = () => {
    target.replaceChildren();
    for (const [value, text] of [["discovery", context?.discovery?.label ?? "Discovery"], ["development", "Development conversation"]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = text; target.append(option);
    }
    target.value = selected;
    target.disabled = Boolean(pending) || nativePending;
    help.textContent = selected === "development"
      ? "Messages go to Development. Implementation still requires confirmation. Browsing artifacts does not change this target."
      : context?.discovery?.help ?? "Waiting for the project workspace.";
    activate.hidden = context?.developmentActive === true;
    activate.disabled = context?.canActivate !== true || Boolean(pending);
    check.hidden = !pending;
    if (pending) help.textContent = "Awaiting the exact discovery action result. Check submission reads that same result; it never sends another action.";
  };
  target.onchange = () => { selected = target.value; update(); changed(); };
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
      context = message;
      document.body.dataset.projectDesign = String(message.designVisible === true);
      update(); changed();
    } else if (message.type === "command") {
      if (message.command === "settings") settings();
      if (message.command === "current-work") currentWork();
      if (message.command === "development-target" && !pending && !nativePending && !document.querySelector("#message").value.trim()) {
        selected = "development"; update(); changed();
      }
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
    nativePending(value) { nativePending = value; update(); },
    discovery: () => selected === "discovery",
    canSend: () => !pending && (selected !== "discovery" || context?.discovery?.enabled === true),
    entries: () => (context?.entries ?? []).map(entry => ({ ...entry, savedEvidenceProjection: true })),
    submit(text) {
      if (!context?.discovery?.enabled || pending) return Promise.reject(new Error("This discovery action is not available."));
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        pending = { id, resolve, reject }; update();
        send({ type: "discovery-send", id, text, key: context.discovery.key });
      });
    },
    publish(snapshot) {
      send({ type: "status", status: snapshot.workflow?.status ?? snapshot.installation?.status ?? "unavailable",
        active: snapshot.installation?.status === "ready",
        role: snapshot.workflow?.activeRole ?? null, reason: snapshot.workflow?.reason ?? snapshot.installation?.reason ?? null,
        designRevision: snapshot.design?.binding?.revisionId ?? null,
        questions: snapshot.workflow?.questionCounts?.unanswered ?? 0, permissions: snapshot.accessRequests?.length ?? 0,
        confirmations: snapshot.workflow?.implementationConfirmations?.filter(item => item.status === "pending").length ?? 0 });
    },
  };
}
