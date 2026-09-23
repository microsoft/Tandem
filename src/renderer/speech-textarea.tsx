import {
  createContext, useCallback, useContext, useId, useImperativeHandle, useLayoutEffect,
  useMemo, useRef, useState, type ReactNode, type Ref, type TextareaHTMLAttributes,
} from "react";
import { ExternalLink, LoaderCircle, LogIn, Mic, Square, X } from "lucide-react";
import { createAzureSpeechSession, type SpeechSession, type SpeechSessionFactory } from "./speech-recognizer.js";
import { useUi } from "./ui-context.js";
import { composeSpeechDraft } from "./speech-input.js";

type CaptureState = "starting" | "listening" | "stopping";
type Status = { text: string; kind: "idle" | "error" };
interface OperationBase {
  owner: string;
  identity: string;
  draftKey: string;
  cancel: (message?: string, failed?: boolean) => void;
  blockSubmit?: () => void;
}
type Operation = OperationBase & (
  | { kind: "capture"; input: HTMLTextAreaElement }
  | { kind: "login" }
);
interface SpeechContextValue {
  identity: string;
  enabled: boolean;
  active: Operation | null;
  loginStatus: Status | null;
  signInPlacement: "inline" | "header";
  signIn: () => Promise<void>;
  createSession: SpeechSessionFactory;
  acquire: (operation: Operation) => boolean;
  release: (operation: Operation) => void;
  publishLogin: (status: Status) => void;
}
const SpeechContext = createContext<SpeechContextValue | null>(null);
const initialStatus: Status = { text: "Audio goes to Azure. You choose when to send.", kind: "idle" };

export function useSpeechCoordinator() {
  const context = useContext(SpeechContext);
  if (!context) throw new Error("Voice input requires a SpeechProvider.");
  return context;
}

/** One provider per effort root; changing effort identity also releases any microphone or sign-in. */
export function SpeechProvider({
  children, createSession = createAzureSpeechSession, signInPlacement = "inline",
}: { children: ReactNode; createSession?: SpeechSessionFactory; signInPlacement?: "inline" | "header" }) {
  const { state } = useUi();
  const identity = JSON.stringify([state.prototypeId, state.generation]);
  const enabled = state.provider?.canSubmitAnswers !== false && !state.effortReset;
  const current = useRef<Operation | null>(null);
  const login = useRef<Login | null>(null);
  const owner = useId();
  const mounted = useRef(true);
  const [active, setActive] = useState<Operation | null>(null);
  const [loginStatus, setLoginStatus] = useState<Status | null>(null);
  const acquire = useCallback((operation: Operation) => {
    if (current.current || !mounted.current) return false;
    current.current = operation;
    setActive(operation);
    return true;
  }, []);
  const release = useCallback((operation: Operation) => {
    if (current.current !== operation) return;
    current.current = null;
    if (mounted.current) setActive(null);
  }, []);
  const publishLogin = useCallback((status: Status) => {
    if (mounted.current) setLoginStatus(status);
  }, []);
  const completeLogin = useCallback((record: Login, result: Status) => {
    if (login.current !== record) return;
    login.current = null;
    clearTimeout(record.timer);
    release(record.operation);
    record.abort.abort();
    publishLogin(result);
  }, [release, publishLogin]);
  const signIn = useCallback(async () => {
    if (!enabled || !mounted.current) return;
    const record: Login = {
      operation: {
        owner, identity, draftKey: identity, kind: "login",
        cancel: (message, failed) => completeLogin(record, {
          text: message || "Microsoft sign-in cancelled. Your draft is unchanged.", kind: failed ? "error" : "idle",
        }),
      },
      abort: new AbortController(),
    };
    if (!acquire(record.operation)) return;
    login.current = record;
    setLoginStatus(null);
    record.timer = setTimeout(() => completeLogin(record, {
      text: "Microsoft sign-in timed out. Select Sign in to retry.", kind: "error",
    }), 190_000);
    try {
      // The provider opens the system browser; the UI must not create a second popup.
      const options: RequestInit = {
        method: "POST", headers: { "Content-Type": "application/json", "X-Tandem-Speech": "1" },
        body: "{}", cache: "no-store", signal: record.abort.signal,
      };
      let response = await fetch("/api/speech/login", options);
      if (response.status === 404 && !record.abort.signal.aborted) response = await fetch("/api/speech/sign-in", options);
      const result = await response.json();
      record.abort.signal.throwIfAborted();
      if (!response.ok || result.authenticated !== true) {
        throw new Error(result.error || "Microsoft sign-in was not confirmed. Please retry.");
      }
      completeLogin(record, { text: "Signed in to Microsoft. Select Mic when you are ready to speak.", kind: "idle" });
    } catch (error) {
      if (login.current === record) completeLogin(record, {
        text: error instanceof Error ? error.message : "Microsoft sign-in failed. Please retry.", kind: "error",
      });
    }
  }, [enabled, owner, identity, acquire, completeLogin]);

  useLayoutEffect(() => {
    mounted.current = true;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !current.current) return;
      event.preventDefault();
      current.current.cancel();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden" && current.current?.kind === "capture") {
        current.current.cancel("Speech cancelled while Tandem is hidden. Your original draft is unchanged.");
      }
    };
    const pagehide = () => current.current?.cancel();
    const submit = (event: SubmitEvent) => {
      const operation = current.current;
      if (operation?.kind !== "capture" || event.target !== operation.input.form) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      operation.blockSubmit?.();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("submit", submit, true);
    window.addEventListener("pagehide", pagehide);
    return () => {
      mounted.current = false;
      current.current?.cancel();
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("submit", submit, true);
      window.removeEventListener("pagehide", pagehide);
    };
  }, []);
  useLayoutEffect(() => {
    if (current.current && (current.current.identity !== identity || !enabled)) {
      current.current.cancel("Speech cancelled because the active effort or provider changed.");
    }
    setLoginStatus(null);
  }, [identity, enabled]);

  const context = useMemo(() => ({
    identity, enabled, active, loginStatus, signInPlacement, signIn, createSession, acquire, release, publishLogin,
  }), [identity, enabled, active, loginStatus, signInPlacement, signIn, createSession, acquire, release, publishLogin]);
  return <SpeechContext.Provider value={context}>{children}</SpeechContext.Provider>;
}

export function SpeechSignInControl() {
  const speech = useSpeechCoordinator();
  const signingIn = speech.active?.kind === "login";
  const message = signingIn
    ? "Complete Microsoft sign-in in your browser. Your microphone is off."
    : speech.loginStatus?.text || "";
  return <div className="speech-header-sign-in">
    <button id="speech-sign-in" className="reload-button" type="button"
      disabled={!speech.enabled || Boolean(speech.active)}
      title="Sign in with Microsoft for Azure Speech. This does not turn on the microphone."
      aria-describedby="speech-header-status" onClick={() => { void speech.signIn(); }}>
      <LogIn size={15} aria-hidden="true" />{signingIn ? "Signing in..." : "Sign in"}
    </button>
    {signingIn && <button className="reload-button" type="button" title="Cancel sign-in" aria-label="Cancel Microsoft sign-in"
      onClick={() => speech.active?.cancel()}><X size={15} aria-hidden="true" /></button>}
    <span id="speech-header-status" role="status" aria-live="polite" data-status={speech.loginStatus?.kind}
      className={speech.loginStatus?.kind === "error" ? "speech-status speech-header-error" : "visually-hidden"}>
      {message}
    </span>
  </div>;
}

export interface VoiceComposerOptions {
  voiceOptions: ReactNode;
  actions: ReactNode;
}

export function VoiceComposer({ input, toggle, voiceOptions, actions, feedback }: VoiceComposerOptions & {
  input: ReactNode; toggle: ReactNode; feedback: ReactNode;
}) {
  return <div className="voice-composer">
    <div className="voice-composer-row">
      <div className="voice-composer-microphone">{toggle}{voiceOptions}</div>
      {input}
      {actions}
    </div>
    {feedback}
  </div>;
}

export interface SpeechTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value" | "defaultValue"> {
  value: string;
  onValueChange: (value: string) => void;
  ref?: Ref<HTMLTextAreaElement>;
  /** Draft identity when a mounted textarea switches between questions or artifacts. */
  speechKey?: string;
  /** Capture associated selection state here; return a callback to restore it on cancellation. */
  onSpeechStart?: () => void | (() => void);
  composer?: VoiceComposerOptions;
}
interface Capture {
  operation: Operation;
  baseline: string;
  start: number;
  end: number;
  committed: string;
  partial: string;
  state: CaptureState;
  abort: AbortController;
  session?: SpeechSession;
  timer?: ReturnType<typeof setTimeout>;
  onValueChange: (value: string) => void;
  rollback?: () => void;
}
interface Login {
  operation: Operation;
  abort: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}

function isAvailable(input: HTMLTextAreaElement | null) {
  return Boolean(input?.isConnected && !input.disabled && !input.matches(":disabled")
    && !input.closest("[hidden], [inert], [aria-hidden='true']"));
}

export function SpeechTextarea({
  value, onValueChange, ref: forwardedRef, speechKey = "", onSpeechStart,
  disabled, readOnly, maxLength, onKeyDown, composer, ...attributes
}: SpeechTextareaProps) {
  const context = useContext(SpeechContext);
  if (!context) throw new Error("SpeechTextarea requires a SpeechProvider.");
  const speech = context;
  const owner = useId();
  const statusId = `speech-status-${owner.replace(/:/g, "")}`;
  const input = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => input.current!, []);
  const focusAfterCommit = useRef<{ key: string; position: number } | null>(null);
  const capture = useRef<Capture | null>(null);
  const mounted = useRef(true);
  const [phase, setPhase] = useState<CaptureState | null>(null);
  const [status, setStatus] = useState(initialStatus);
  const [available, setAvailable] = useState(false);
  const key = JSON.stringify([speech.identity, speechKey, attributes.id || attributes.name || ""]);
  const latest = useRef({ key, enabled: speech.enabled && !disabled && !readOnly });
  useLayoutEffect(() => {
    latest.current = { key, enabled: speech.enabled && !disabled && !readOnly };
    checkAvailability();
  });

  function checkAvailability() {
    const next = isAvailable(input.current) && latest.current.enabled;
    if (mounted.current) setAvailable((previous) => previous === next ? previous : next);
    const operation = capture.current?.operation;
    if (operation && (!next || operation.draftKey !== latest.current.key)) {
      operation.cancel("Speech cancelled because the active conversation changed. Your original draft is unchanged.");
    }
  }
  useLayoutEffect(() => {
    mounted.current = true;
    const node = input.current!;
    // Observe availability only. The textarea and controls are always rendered by React.
    const observer = new MutationObserver(checkAvailability);
    for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ["hidden", "inert", "disabled", "aria-hidden"], childList: true });
    }
    return () => {
      mounted.current = false;
      observer.disconnect();
      capture.current?.operation.cancel();
    };
  }, []);
  useLayoutEffect(() => () => {
    focusAfterCommit.current = null;
    capture.current?.operation.cancel("Speech cancelled because the active conversation changed. Your original draft is unchanged.");
  }, [key]);
  useLayoutEffect(() => {
    if (speech.loginStatus && !capture.current) setStatus(speech.loginStatus);
  }, [speech.loginStatus]);
  useLayoutEffect(() => {
    const focus = focusAfterCommit.current;
    if (!focus || capture.current) return;
    focusAfterCommit.current = null;
    if (focus.key === key && isAvailable(input.current)) {
      input.current!.focus();
      input.current!.setSelectionRange(focus.position, focus.position);
    }
  });

  function detach(record: Capture) {
    if (capture.current !== record) return;
    capture.current = null;
    clearTimeout(record.timer);
    speech.release(record.operation);
    record.abort.abort();
    record.session?.close();
    if (mounted.current) setPhase(null);
  }
  function cancelCapture(record: Capture, message = "Speech cancelled. Your original draft is unchanged.", failed = false) {
    if (capture.current !== record) return;
    detach(record);
    record.onValueChange(record.baseline);
    record.rollback?.();
    if (mounted.current) setStatus({ text: message, kind: failed ? "error" : "idle" });
  }
  function validCapture(record: Capture) {
    if (capture.current !== record) return false;
    if (latest.current.key !== key || !latest.current.enabled || !isAvailable(input.current)) {
      cancelCapture(record, "Speech cancelled because the active conversation changed. Your original draft is unchanged.");
      return false;
    }
    return true;
  }
  function showTranscript(record: Capture) {
    if (!validCapture(record)) return;
    const text = [record.committed, record.partial].filter(Boolean).join(" ");
    const draft = composeSpeechDraft(record.baseline, record.start, record.end, text);
    const maximum = maxLength != null && maxLength >= 0 ? maxLength : 4000;
    if (draft.length > maximum) {
      cancelCapture(record, `Speech exceeded this input's ${maximum.toLocaleString()} character limit. Your original draft is unchanged; try a shorter message.`, true);
      return;
    }
    record.onValueChange(draft);
    return draft;
  }
  function finish(record: Capture) {
    if (!validCapture(record)) return;
    record.partial = "";
    const finalDraft = showTranscript(record);
    if (capture.current !== record) return;
    detach(record);
    if (!record.committed) record.rollback?.();
    if (mounted.current) {
      setStatus({ text: record.committed ? "Ready to edit and send." : "No speech recognized. Try again.", kind: "idle" });
      focusAfterCommit.current = { key, position: finalDraft!.length };
    }
  }
  async function stop(record: Capture) {
    if (!validCapture(record) || record.state === "stopping") return;
    if (record.state === "starting") { cancelCapture(record); return; }
    record.state = "stopping";
    setPhase("stopping");
    clearTimeout(record.timer);
    record.timer = setTimeout(() => {
      cancelCapture(record, "Speech did not stop in time. Your original draft is unchanged; retry.", true);
    }, 8000);
    try {
      await record.session!.stop();
      finish(record);
    } catch {
      cancelCapture(record, "Could not finish speech capture. Your original draft is unchanged; retry.", true);
    }
  }
  async function start() {
    const node = input.current;
    if (!node || !isAvailable(node) || !latest.current.enabled) return;
    const record: Capture = {
      operation: {
        owner, identity: speech.identity, draftKey: key, input: node, kind: "capture",
        cancel: (message, failed) => cancelCapture(record, message, failed),
        blockSubmit: () => setStatus({ text: "Stop speech input before sending, or Cancel to restore your draft.", kind: "idle" }),
      },
      baseline: value, start: node.selectionStart ?? value.length, end: node.selectionEnd ?? value.length,
      committed: "", partial: "", state: "starting", abort: new AbortController(), onValueChange,
    };
    if (!speech.acquire(record.operation)) return;
    capture.current = record;
    setPhase("starting");
    setStatus(initialStatus);
    record.timer = setTimeout(() => {
      cancelCapture(record, "Speech startup timed out. Check sign-in and microphone permissions, then retry.", true);
    }, 30_000);
    try {
      record.rollback = onSpeechStart?.() || undefined;
      const session = await speech.createSession({
        transcript(text, final) {
          if (!validCapture(record)) return;
          if (final) {
            record.committed = [record.committed, text.trim()].filter(Boolean).join(" ");
            record.partial = "";
          } else record.partial = text.trim();
          showTranscript(record);
        },
        error(message) { cancelCapture(record, message, true); },
        ended() { if (record.state !== "stopping") finish(record); },
      }, record.abort.signal);
      if (!validCapture(record)) { session.close(); return; }
      record.session = session;
      await session.start();
      if (!validCapture(record)) return;
      record.state = "listening";
      setPhase("listening");
      clearTimeout(record.timer);
      record.timer = setTimeout(() => { void stop(record); }, 120_000);
    } catch (error) {
      cancelCapture(record, error instanceof Error ? error.message : "Could not start speech input. Retry or type your message.", true);
    }
  }
  const ownCapture = speech.active?.owner === owner && speech.active.kind === "capture";
  const signingIn = speech.active?.kind === "login";
  const visibleStatus = signingIn
    ? { text: "Complete Microsoft sign-in in your browser, then return here. Your microphone is off.", kind: "starting" }
    : phase
      ? { text: status.text.startsWith("Stop speech input") ? status.text
        : phase === "starting" ? "Connecting to Azure Speech..."
          : phase === "stopping" ? "Finishing transcript..." : "Listening... Stop to edit or send.", kind: phase }
      : status === initialStatus && speech.loginStatus ? speech.loginStatus : status;
  const uiKey = attributes.id || attributes.name || owner;
  const busy = Boolean(speech.active);

  const textarea = <textarea {...attributes} ref={input} value={value} disabled={disabled} maxLength={maxLength}
      readOnly={readOnly || Boolean(phase)} data-speech-input=""
      aria-describedby={[attributes["aria-describedby"], statusId].filter(Boolean).join(" ")}
      onChange={(event) => {
        const record = capture.current;
        if (record) {
          detach(record);
          record.rollback?.();
          setStatus({ text: "Speech cancelled because the draft was edited. Your edited text is ready to use.", kind: "idle" });
        }
        onValueChange(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (capture.current && event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          capture.current.operation.blockSubmit?.();
          return;
        }
        onKeyDown?.(event);
      }} />;
  const toggle = <button type="button" className="speech-toggle" data-ui-key={`${uiKey}-speech-toggle`}
        disabled={!available || (busy && !ownCapture) || phase === "stopping"}
        title="Dictate with Azure Speech. Audio is sent to Azure; text is never sent as a message automatically."
        aria-label={ownCapture ? "Stop speech input" : "Start speech input"} aria-pressed={ownCapture}
        aria-describedby={statusId} onClick={() => { if (capture.current) void stop(capture.current); else void start(); }}>
        {phase === "starting" || phase === "stopping" ? <LoaderCircle size={14} aria-hidden="true" />
          : ownCapture ? <Square size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
        {!composer && (phase === "starting" ? "Starting..." : phase === "stopping" ? "Finishing..." : ownCapture ? "Stop" : "Mic")}
      </button>;
  const feedback = <>
      {speech.signInPlacement === "inline" && <button type="button" className="speech-sign-in" data-ui-key={`${uiKey}-speech-sign-in`}
        disabled={!available || busy} aria-describedby={statusId}
        title="Open Microsoft sign-in in your browser. This does not turn on the microphone." onClick={() => { void speech.signIn(); }}>
        <LogIn size={14} aria-hidden="true" />{signingIn ? "Signing in..." : "Sign in with Microsoft"}
      </button>}
      <button type="button" className="speech-cancel" data-ui-key={`${uiKey}-speech-cancel`}
        hidden={!ownCapture && !(signingIn && speech.signInPlacement === "inline")}
        aria-label={signingIn ? "Cancel Microsoft sign-in" : "Cancel speech and restore draft"}
        onClick={() => speech.active?.cancel()}>
        <X size={14} aria-hidden="true" />{signingIn ? "Cancel sign-in" : "Cancel"}
      </button>
      <span id={statusId} className="speech-status" role="status" aria-live="polite" data-status={visibleStatus.kind}>
        {visibleStatus.text}
      </span>
      <a href="/speech" target="_blank" rel="noopener noreferrer" hidden={visibleStatus.kind !== "error"}
        title="Open Tandem in your browser and sign in with Microsoft there, then select Mic. Your draft stays here.">
        <ExternalLink size={14} aria-hidden="true" />Open Tandem in browser
      </a>
  </>;
  if (composer) return <VoiceComposer {...composer} input={textarea} toggle={toggle}
    feedback={<div className="speech-controls voice-composer-feedback" data-ui-key={`${uiKey}-speech-controls`}
      hidden={!phase && visibleStatus.kind !== "error" && speech.signInPlacement !== "inline"}>{feedback}</div>} />;
  return <>{textarea}
    <div className="speech-controls" data-ui-key={`${uiKey}-speech-controls`}>{toggle}{feedback}</div>
  </>;
}
