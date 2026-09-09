import type { SpeechSession, SpeechSessionFactory } from "./speech-recognizer.js";

type ChatInput = HTMLInputElement | HTMLTextAreaElement;
type CaptureState = "starting" | "listening" | "stopping";
interface Controls {
  input: ChatInput;
  bar: HTMLElement;
  toggle: HTMLButtonElement;
  signIn: HTMLButtonElement;
  cancel: HTMLButtonElement;
  status: HTMLElement;
  browserLink?: HTMLAnchorElement;
}
interface Capture {
  controls: Controls;
  key: string;
  baseline: string;
  start: number;
  end: number;
  committed: string;
  partial: string;
  choices: { name: string; value: string; checked: boolean }[];
  state: CaptureState;
  abort: AbortController;
  session?: SpeechSession;
  timer?: ReturnType<typeof setTimeout>;
}

export function composeSpeechDraft(baseline: string, start: number, end: number, transcript: string): string {
  if (!transcript) return baseline;
  const before = baseline.slice(0, start);
  const after = baseline.slice(end);
  return before + (before && !/\s$/.test(before) ? " " : "") + transcript
    + (after && !/^[\s.,!?;:]/.test(after) ? " " : "") + after;
}

export function installSpeechInputs(
  doc: Document,
  createSession: SpeechSessionFactory,
  identity: () => string,
) {
  const controls = new Map<ChatInput, Controls>();
  let active: Capture | null = null;
  let login: AbortController | null = null;
  let loginStatus = "";
  let loginFailed = false;
  let writing = false;
  let nextId = 0;
  const key = (input: ChatInput) => JSON.stringify([
    identity(), input.closest("form")?.dataset.draftKey || "", input.id || input.dataset.uiKey,
  ]);
  const available = (input: ChatInput) => input.isConnected && !input.disabled
    && !input.closest("[hidden], [inert]");
  const notifyInput = (input: ChatInput) => {
    writing = true;
    try { input.dispatchEvent(new Event("input", { bubbles: true })); }
    finally { writing = false; }
  };
  const updateControls = () => {
    for (const control of controls.values()) {
      const capture = active?.controls === control ? active : null;
      control.toggle.disabled = !available(control.input) || Boolean(active && !capture)
        || capture?.state === "stopping" || Boolean(login);
      control.signIn.disabled = !available(control.input) || Boolean(active || login);
      control.signIn.textContent = login ? "Signing in..." : "Sign in with Microsoft";
      control.toggle.textContent = capture?.state === "starting" ? "Starting..."
        : capture?.state === "stopping" ? "Finishing..." : capture ? "Stop" : "Mic";
      control.toggle.setAttribute("aria-pressed", String(Boolean(capture)));
      control.toggle.setAttribute("aria-label", capture ? "Stop speech input" : "Start speech input");
      control.cancel.hidden = !capture && !login;
      control.cancel.textContent = login ? "Cancel sign-in" : "Cancel";
      control.cancel.setAttribute("aria-label", login ? "Cancel Microsoft sign-in" : "Cancel speech and restore draft");
      if (control.browserLink) control.browserLink.hidden = control.status.dataset.status !== "error";
      if (capture) {
        control.status.textContent = capture.state === "starting" ? "Connecting to Azure Speech..."
          : capture.state === "stopping" ? "Finishing transcript..." : "Listening... Stop to edit or send.";
        control.status.dataset.status = capture.state;
      } else if (login) {
        control.status.textContent = "Complete Microsoft sign-in in your browser, then return here. Your microphone is off.";
        control.status.dataset.status = "starting";
      }
    }
  };
  const detach = (capture: Capture) => {
    active = null;
    clearTimeout(capture.timer);
    capture.controls.input.readOnly = false;
    capture.abort.abort();
    capture.session?.close();
  };
  const restoreBaseline = (capture: Capture) => {
    const input = capture.controls.input;
    input.value = capture.baseline;
    notifyInput(input);
    const form = input.closest("form");
    for (const radio of form?.querySelectorAll<HTMLInputElement>('input[type="radio"]') || []) {
      const previous = capture.choices.find((choice) => choice.name === radio.name && choice.value === radio.value);
      if (previous) radio.checked = previous.checked;
    }
    form?.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const cancel = (message = "Speech cancelled. Your original draft is unchanged.", failed = false, restore = true) => {
    if (!active) return;
    const capture = active;
    detach(capture);
    if (restore && (key(capture.controls.input) === capture.key || !capture.controls.input.isConnected)) {
      restoreBaseline(capture);
    }
    capture.controls.status.textContent = message;
    capture.controls.status.dataset.status = failed ? "error" : "idle";
    updateControls();
  };
  const transcript = (capture: Capture) => [capture.committed, capture.partial].filter(Boolean).join(" ");
  const showTranscript = (capture: Capture) => {
    const input = capture.controls.input;
    const value = composeSpeechDraft(capture.baseline, capture.start, capture.end, transcript(capture));
    const maximum = Number(input.getAttribute("maxlength") || 4000);
    if (value.length > maximum) {
      cancel(`Speech exceeded this input's ${maximum.toLocaleString()} character limit. Your original draft is unchanged; try a shorter message.`, true);
      return;
    }
    input.value = value;
    notifyInput(input);
  };
  const finish = (capture: Capture) => {
    if (active !== capture) return;
    // Only confirmed recognition results become editable text.
    capture.partial = "";
    showTranscript(capture);
    if (active !== capture) return;
    detach(capture);
    capture.controls.status.textContent = capture.committed ? "Ready to edit and send." : "No speech recognized. Try again.";
    capture.controls.status.dataset.status = "idle";
    const input = capture.controls.input;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    updateControls();
  };
  const stop = async () => {
    const capture = active;
    if (!capture || capture.state === "stopping") return;
    if (capture.state === "starting") { cancel(); return; }
    capture.state = "stopping";
    clearTimeout(capture.timer);
    capture.timer = setTimeout(() => {
      if (active === capture) cancel("Speech did not stop in time. Your original draft is unchanged; retry.", true);
    }, 8000);
    updateControls();
    try {
      await capture.session!.stop();
      finish(capture);
    } catch {
      if (active === capture) cancel("Could not finish speech capture. Your original draft is unchanged; retry.", true);
    }
  };
  const start = async (control: Controls) => {
    if (active || login || !available(control.input) || control.input.readOnly) return;
    const input = control.input;
    const capture: Capture = {
      controls: control, key: key(input), baseline: input.value,
      start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length,
      committed: "", partial: "", state: "starting", abort: new AbortController(),
      choices: Array.from(input.closest("form")?.querySelectorAll<HTMLInputElement>('input[type="radio"]') || [])
        .map((radio) => ({ name: radio.name, value: radio.value, checked: radio.checked })),
    };
    active = capture;
    input.readOnly = true;
    capture.timer = setTimeout(() => {
      if (active === capture) cancel("Speech startup timed out. Check sign-in and microphone permissions, then retry.", true);
    }, 30_000);
    updateControls();
    try {
      const session = await createSession({
        transcript(text, final) {
          if (active !== capture) return;
          sync();
          if (active !== capture) return;
          if (final) {
            capture.committed = [capture.committed, text.trim()].filter(Boolean).join(" ");
            capture.partial = "";
          } else capture.partial = text.trim();
          showTranscript(capture);
        },
        error(message) { if (active === capture) cancel(message, true); },
        ended() { if (active === capture && capture.state !== "stopping") finish(capture); },
      }, capture.abort.signal);
      if (active !== capture) { session.close(); return; }
      capture.session = session;
      await session.start();
      if (active !== capture) return;
      capture.state = "listening";
      clearTimeout(capture.timer);
      capture.timer = setTimeout(() => { void stop(); }, 120_000);
      updateControls();
    } catch (error) {
      if (active === capture) cancel(
        error instanceof Error ? error.message : "Could not start speech input. Retry or type your message.", true,
      );
    }
  };
  const signIn = async (control: Controls) => {
    if (active || login || !available(control.input)) return;
    const controller = new AbortController();
    login = controller;
    loginFailed = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 190_000);
    updateControls();
    try {
      const response = await fetch("/api/speech/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tandem-Speech": "1" },
        body: "{}",
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || result.authenticated !== true) {
        throw new Error(result.error || "Microsoft sign-in was not confirmed. Please retry.");
      }
      controller.signal.throwIfAborted();
      loginStatus = "Signed in to Microsoft. Select Mic when you are ready to speak.";
    } catch (error) {
      loginFailed = !controller.signal.aborted || timedOut;
      loginStatus = timedOut ? "Microsoft sign-in timed out. Select Sign in with Microsoft to retry."
        : controller.signal.aborted ? "Microsoft sign-in cancelled. Your draft is unchanged."
        : error instanceof Error ? error.message : "Microsoft sign-in failed. Please retry.";
    } finally {
      clearTimeout(timer);
      login = null;
      for (const current of controls.values()) {
        current.status.textContent = loginStatus;
        current.status.dataset.status = loginFailed ? "error" : "idle";
      }
      updateControls();
    }
  };
  function attach(input: ChatInput): Controls {
    const bar = doc.createElement("div");
    bar.className = "speech-controls";
    const toggle = doc.createElement("button");
    toggle.type = "button";
    toggle.className = "speech-toggle";
    toggle.title = "Dictate with Azure Speech. Audio is sent to Azure; text is never sent as a message automatically.";
    const signInButton = doc.createElement("button");
    signInButton.type = "button";
    signInButton.className = "speech-sign-in";
    signInButton.textContent = "Sign in with Microsoft";
    signInButton.title = "Open Microsoft sign-in in your browser. This does not turn on the microphone.";
    const cancelButton = doc.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "speech-cancel";
    cancelButton.textContent = "Cancel";
    const status = doc.createElement("span");
    status.className = "speech-status";
    status.id = "speech-status-" + ++nextId;
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = loginStatus || "Audio goes to Azure. You choose when to send.";
    status.dataset.status = loginFailed ? "error" : "idle";
    toggle.setAttribute("aria-describedby", status.id);
    signInButton.setAttribute("aria-describedby", status.id);
    cancelButton.setAttribute("aria-label", "Cancel speech and restore draft");
    bar.append(toggle, signInButton, cancelButton, status);
    let browserLink: HTMLAnchorElement | undefined;
    if (doc.defaultView?.location?.href) {
      browserLink = doc.createElement("a");
      browserLink.href = doc.defaultView.location.href;
      browserLink.target = "_blank";
      browserLink.rel = "noopener noreferrer";
      browserLink.textContent = "Open Tandem in browser";
      browserLink.hidden = true;
      bar.append(browserLink);
    }
    input.after(bar);
    const control = { input, bar, toggle, signIn: signInButton, cancel: cancelButton, status, browserLink };
    controls.set(input, control);
    toggle.addEventListener("click", () => {
      if (active?.controls === control) void stop();
      else void start(control);
    });
    signInButton.addEventListener("click", () => { void signIn(control); });
    cancelButton.addEventListener("click", () => { if (login) login.abort(); else cancel(); });
    return control;
  }
  function sync() {
    const inputs = Array.from(doc.querySelectorAll<ChatInput>("[data-speech-input]"));
    for (const input of inputs) if (!controls.has(input)) attach(input);
    if (active) {
      const input = inputs.find((candidate) => key(candidate) === active!.key && available(candidate));
      if (!input) {
        cancel("Speech cancelled because the active conversation changed.");
      } else {
        active.controls.input.readOnly = false;
        active.controls = controls.get(input)!;
        input.readOnly = true;
      }
    }
    for (const [input] of controls) if (!input.isConnected) controls.delete(input);
    updateControls();
  }
  doc.addEventListener("submit", (event) => {
    if (active && event.target === active.controls.input.closest("form")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      active.controls.status.textContent = "Stop speech input before sending, or Cancel to restore your draft.";
    }
  }, true);
  doc.addEventListener("keydown", (event) => {
    if (login && event.key === "Escape") { event.preventDefault(); login.abort(); }
    if (active && event.key === "Escape") { event.preventDefault(); cancel(); }
  }, true);
  doc.addEventListener("input", (event) => {
    if (!writing && active && event.target === active.controls.input) {
      cancel("Speech cancelled because the draft was edited. Your edited text is ready to use.", false, false);
    }
  }, true);
  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "hidden") cancel("Speech cancelled while Tandem is hidden.");
  });
  doc.defaultView?.addEventListener("pagehide", () => { login?.abort(); cancel(); });
  sync();
  return {
    sync,
    cancel,
    cancelForForm(form: HTMLFormElement) {
      if (active?.controls.input.closest("form") === form) {
        cancel("Speech cancelled because the active conversation changed.");
      }
    },
    beforeRender() {
      if (!active) return;
      active.controls.input.readOnly = false;
      restoreBaseline(active);
    },
    afterRender() {
      sync();
      if (active) showTranscript(active);
    },
  };
}
