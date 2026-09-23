import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ExternalLink, Mic, Square } from "lucide-react";
import { createSketchLiveSession, type SketchLiveSession, type SketchLiveSessionFactory } from "./sketch-live-session.js";
import { appendSketchLiveCaption } from "./sketch-live-captions.js";
import { useSpeechCoordinator, VoiceComposer, type VoiceComposerOptions } from "./speech-textarea.js";

interface Caption { role: "user" | "assistant"; text: string; start: number; end: number }
interface Props {
  identity: string;
  enabled: boolean;
  canStart: boolean;
  context: string[];
  input: RefObject<HTMLTextAreaElement | null>;
  revise: (instruction: string, signal: AbortSignal) => Promise<string>;
  createSession?: SketchLiveSessionFactory;
  composer?: VoiceComposerOptions & { input: (caption: string | null) => ReactNode };
}
interface Conversation {
  abort: AbortController;
  session?: SketchLiveSession;
  operation: Parameters<ReturnType<typeof useSpeechCoordinator>["acquire"]>[0];
  captions: Caption[];
  previews: Record<Caption["role"], string>;
  pending: { id: string; offset: number } | null;
  seen: Set<string>;
  consumed: number;
  working: boolean;
  speaking: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const initialStatus = "Audio and sketch context go to Azure GPT-live. Requested edits create saved drawing revisions; approval stays manual.";
const messageOf = (error: unknown) => error instanceof Error ? error.message : "GPT-live could not complete the request.";

export function SketchLivePanel(props: Props) {
  const speech = useSpeechCoordinator();
  const owner = useId();
  const container = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const current = useRef<Conversation | null>(null);
  const lastConversation = useRef<Conversation | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [phase, setPhase] = useState<"idle" | "starting" | "listening">("idle");
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState("");
  const [captions, setCaptions] = useState({ user: "", assistant: "" });

  function available() {
    return mounted.current && latest.current.enabled && container.current?.isConnected
      && !container.current.closest("[hidden], [inert], [aria-hidden='true']");
  }
  function active(record: Conversation) {
    return current.current === record && !record.abort.signal.aborted && available();
  }
  function stop(message = "Voice stopped. Drawing work already submitted may still finish.", failure = false) {
    const record = current.current;
    if (!record) return;
    current.current = null;
    clearTimeout(record.timer);
    record.abort.abort();
    record.session?.close();
    speech.release(record.operation);
    if (mounted.current) {
      setPhase("idle");
      setStatus(message);
      setError(failure ? message : "");
    }
  }
  function feedback(record: Conversation, content: string, delegationId: string, spoken = content) {
    if (!active(record)) return;
    record.session?.context(content, delegationId);
    if (active(record)) record.session?.commentary(spoken, delegationId);
  }
  async function delegate(record: Conversation) {
    record.timer = undefined;
    const pending = record.pending;
    if (!pending || !active(record)) return;
    record.pending = null;
    for (const message of latest.current.context) {
      if (!active(record)) return;
      record.session?.context(message, pending.id);
    }
    if (record.working) {
      feedback(record, "A drawing revision is still running. No new edit was submitted. Ask again after it finishes.", pending.id,
        "The previous drawing change is still running. Please wait for it to finish before asking for another edit.");
      return;
    }
    const fresh = record.captions.filter((caption) => caption.role === "user" && caption.end > record.consumed);
    if (!fresh.length) {
      feedback(record, "No new user instruction was transcribed. Ask the user to repeat the requested drawing change.", pending.id,
        "I did not catch a new drawing instruction. Please repeat the change you want.");
      setError("No new drawing instruction was transcribed. Please repeat it.");
      return;
    }
    const spoken = fresh.map((caption) => caption.text).join("").trim();
    const discussion = record.captions.filter((caption) => caption.role === "assistant").slice(-2)
      .map((caption) => caption.text).join("").slice(-700);
    const instruction = [
      "Apply only the drawing change requested in this spoken user instruction. Conversation is context, not approval.",
      `User: ${spoken}`,
      `Recent assistant discussion (not a user request): ${discussion}`,
    ].join("\n");
    if (instruction.length > 4000) {
      feedback(record, "The voice edit exceeds the drawing instruction limit. Ask for a shorter request. No edit was submitted.", pending.id,
        "That drawing request is too long. Please start a new conversation with a shorter request.");
      setError("The voice edit is too long. End voice and start a shorter request.");
      return;
    }
    record.consumed = Math.max(pending.offset, ...fresh.map((caption) => caption.end));
    record.working = true;
    setError("");
    setStatus("Revising drawings from your voice request. You can keep talking.");
    try {
      feedback(record, "The drawing revision is starting. Do not claim success until the client reports the saved result.", pending.id,
        "I am updating the drawings. We can keep talking while that runs.");
      const result = await latest.current.revise(instruction, record.abort.signal);
      if (!active(record)) return;
      feedback(record, result, pending.id);
      if (active(record)) setStatus(result);
    } catch (cause) {
      if (!active(record)) return;
      const message = messageOf(cause);
      setError(message);
      feedback(record, "Drawing revision was not confirmed. Do not claim it succeeded. Ask the user to review the on-screen error and retry explicitly.", pending.id,
        "I could not confirm that drawing change. Please review the on-screen error before retrying.");
    } finally {
      record.working = false;
    }
  }
  function settle(record: Conversation) {
    if (!record.pending) return;
    clearTimeout(record.timer);
    if (record.speaking) return;
    record.timer = setTimeout(() => { void delegate(record).catch((cause) => stop(messageOf(cause), true)); }, 750);
  }

  async function start() {
    const input = latest.current.input.current;
    if (!input || !available() || !latest.current.canStart || current.current) return;
    const record: Conversation = {
      abort: new AbortController(), captions: [], pending: null, consumed: -1, seen: new Set(),
      working: false, speaking: false, previews: { user: "", assistant: "" },
      operation: {
        owner, identity: speech.identity, draftKey: props.identity, input, kind: "capture",
        cancel: (message, failed) => stop(message?.replace("Your original draft is unchanged.", "Submitted drawing work may still finish."), failed),
        blockSubmit: () => setStatus("End voice before submitting a typed drawing revision."),
      },
    };
    if (!speech.acquire(record.operation)) return;
    current.current = record;
    lastConversation.current = record;
    setPhase("starting");
    setStatus("Connecting to GPT-live...");
    setError("");
    setCaptions({ ...record.previews });
    try {
      const session = await (latest.current.createSession ?? createSketchLiveSession)({
        transcript(role, text, start, end) {
          if (!active(record)) return;
          const last = record.captions.at(-1);
          if (last?.role === role && last.start === start) {
            last.text += text;
            last.end = Math.max(last.end, end);
          } else record.captions.push({ role, text, start, end });
          record.previews[role] = appendSketchLiveCaption(record.previews[role], text);
          if (record.captions.length > 80) record.captions.splice(0, record.captions.length - 80);
          if (record.previews[role].length > 8000 || record.captions.some((caption) => caption.text.length > 8000)) {
            stop("GPT-live transcript exceeded its limit. Start a new conversation.", true);
            return;
          }
          setCaptions({ ...record.previews });
          if (role === "user") settle(record);
        },
        delegation(id, offset) {
          if (!active(record) || record.seen.has(id)) return;
          if (record.seen.size >= 100) { stop("Voice reached its edit limit. Start a new conversation."); return; }
          record.seen.add(id);
          record.pending = { id, offset };
          settle(record);
        },
        activity(speaking) {
          if (!active(record)) return;
          record.speaking = speaking;
          if (speaking) clearTimeout(record.timer);
          else settle(record);
        },
        error: (message) => {
          if (current.current === record) stop(message, true);
          else if (mounted.current && lastConversation.current === record
            && latest.current.identity === record.operation.draftKey) setError(message);
        },
        ended: () => { if (current.current === record) stop("GPT-live ended. Drawing work already submitted may still finish."); },
      }, record.abort.signal, latest.current.context);
      if (!active(record)) { session.close(); return; }
      record.session = session;
      await session.start();
      if (!active(record)) return;
      setPhase("listening");
      setStatus("Listening. Discuss the sketch or ask for a drawing change.");
    } catch (cause) {
      if (current.current === record) stop(messageOf(cause), true);
    }
  }

  useLayoutEffect(() => {
    mounted.current = true;
    const observer = new MutationObserver(() => { if (!available()) stop("Voice stopped because Sketch is hidden or unavailable."); });
    for (let node: HTMLElement | null = container.current; node; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: ["hidden", "inert", "aria-hidden"] });
    }
    return () => { mounted.current = false; observer.disconnect(); stop(); };
  }, []);
  useLayoutEffect(() => {
    if (!props.enabled) stop("Voice stopped because Sketch is no longer editable.");
  }, [props.enabled]);
  useLayoutEffect(() => () => stop("Voice stopped because the active effort changed."), [props.identity]);

  const liveCaption = phase === "idle" ? null : `You: ${captions.user.trim()}\nGPT-live: ${captions.assistant.trim()}`;
  const toggle = <button id="sketch-live-toggle" type="button" className="speech-toggle" aria-pressed={phase !== "idle"}
        title={phase === "idle" ? "Talk with GPT-live" : "End voice"}
        aria-label={phase === "idle" ? "Talk with GPT-live" : "End voice"}
        disabled={phase === "idle" && (!props.enabled || !props.canStart || Boolean(speech.active))}
        onClick={() => { if (current.current) stop(); else void start(); }}>
        {phase === "idle" ? <Mic size={14} aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
        {!props.composer && (phase === "idle" ? "Talk with GPT-live" : "End voice")}
      </button>;
  const feedbackView = <>
    <span id="sketch-live-status" className="speech-status" role="status" aria-live="polite">{status}</span>
    {!props.composer && <p className="muted">{initialStatus} Uses Azure CLI sign-in, separate from Azure Speech.</p>}
    {error && <p id="sketch-live-error" className="sketch-error" role="alert">{error}{" "}
      <a href="/" target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />Open Tandem in browser</a>
    </p>}
    {!props.composer && liveCaption !== null && <p className="sketch-live-captions" aria-label="Voice transcript">{liveCaption}</p>}
  </>;
  return <div ref={container} className={props.composer ? "sketch-live-composer" : "sketch-live"} aria-label="GPT-live sketch conversation">
    {props.composer
      ? <VoiceComposer {...props.composer} input={props.composer.input(liveCaption)} toggle={toggle}
        feedback={<div className="voice-composer-feedback" hidden={phase === "idle" && !error}>{feedbackView}</div>} />
      : <><div className="speech-controls">{toggle}</div>{feedbackView}</>}
  </div>;
}
