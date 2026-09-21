import { decodeLivePcmAudio, encodeLivePcmFrame, sketchLiveInputWorklet } from "./sketch-live-audio.js";
import { readSketchLiveInitialContext, sketchLiveFailureMessage } from "../sketch-live-protocol.js";

export interface SketchLiveSession {
  start(): Promise<void>;
  close(): void;
  context(content: string, delegationId: string): void;
  commentary(content: string, delegationId: string): void;
}

export interface SketchLiveEvents {
  transcript(role: "user" | "assistant", text: string, startMs: number, endMs: number): void;
  delegation(id: string, offsetMs: number): void;
  error(message: string): void;
  ended(): void;
  activity?(speaking: boolean): void;
}

export type SketchLiveSessionFactory = (
  events: SketchLiveEvents,
  signal: AbortSignal,
  initialContext?: readonly string[],
) => Promise<SketchLiveSession>;

const messages = {
  origin: "GPT-live requires Tandem's local browser proxy. Open Tandem on localhost and retry.",
  microphone: "Could not open the microphone. Connect an input device, close apps using it, and retry.",
  permission: "Allow microphone access in the browser and your system privacy settings, then start GPT-live again.",
  unsupported: "GPT-live requires a browser with AudioWorklet microphone support. Open Tandem in a supported browser.",
  audio: "Could not initialize browser audio. Check your audio devices and start GPT-live again.",
  autoplay: "Audio playback is blocked or suspended. Allow sound in the browser and start GPT-live again.",
  startup: "GPT-live did not start within 20 seconds. Check microphone access and your connection, then retry.",
  proxy: "Could not open a local GPT-live session. Check the local proxy and Azure sign-in, then retry.",
  response: "The local GPT-live proxy returned an invalid session response. Start a new session to retry.",
  socket: "The GPT-live connection failed or closed unexpectedly. Start a new session to retry.",
  event: "GPT-live sent an invalid event. Start a new session to retry.",
  provider: "GPT-live could not continue. Check the local proxy and Azure sign-in, then retry.",
  buffering: "GPT-live audio or the connection cannot keep up. Start a new session to retry.",
  content: "GPT-live context or commentary is invalid or exceeds the 500-byte UTF-8 limit.",
  initialContext: "The initial sketch context is invalid or too large. Reload the drawings before starting GPT-live.",
  delegation: "GPT-live context messages require a delegation ID. Reload Tandem before retrying.",
  cleanup: "GPT-live could not release every audio or connection resource. Reload Tandem before starting another session.",
  callback: "A GPT-live event callback failed. Resource cleanup will continue.",
};
const STARTUP_MS = 20_000;
const MAX_SESSION_MS = 600_000;
const MAX_SOCKET_BUFFER = 65_536;
const MAX_APPEND_BYTES = 500;
const MAX_TRANSCRIPT_BYTES = 16_384;
const MAX_EVENT_BYTES = 65_536;
const MAX_PLAYBACK_SECONDS = 2;
const MAX_PLAYBACK_NODES = 128;

class LiveError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit && new TextEncoder().encode(value).length <= limit;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

function validOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function notify(callback: () => void): void {
  // A view callback must not prevent the remaining audio/network resources from closing.
  try { callback(); } catch { console.error(messages.callback); }
}

/** Call directly from the explicit user gesture, so resume() retains user activation. */
export const createSketchLiveSession: SketchLiveSessionFactory = async (events, signal, initialContext = []) => {
  let state: "preparing" | "prepared" | "starting" | "ready" | "closed" = "preparing";
  let terminalError: Error | undefined;
  let stream: MediaStream | undefined;
  let audio: AudioContext | undefined;
  let input: MediaStreamAudioSourceNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let mute: GainNode | undefined;
  let socket: WebSocket | undefined;
  let moduleUrl: string | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let startPromise: Promise<void> | undefined;
  let resolveStart: (() => void) | undefined;
  let rejectStart: ((error: Error) => void) | undefined;
  let playbackUntil = 0;
  let speaking = false;
  let watchAudioState = false;
  let lastFrameSequence = 0;
  let cleanupFailed = false;
  let cleanupReported = false;
  let cleanupReportScheduled = false;
  let pendingCleanup = 0;
  const playback = new Set<AudioBufferSourceNode>();
  const request = new AbortController();
  const deadline = Date.now() + MAX_SESSION_MS;
  let rejectCancelled: (error: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  void cancelled.catch(() => {});

  const isClosed = () => state === "closed";
  const scheduleCleanupReport = () => {
    if (cleanupReportScheduled) return;
    cleanupReportScheduled = true;
    // Defer callbacks until every synchronous release and pending close has run.
    queueMicrotask(() => {
      cleanupReportScheduled = false;
      if (!cleanupFailed || cleanupReported || pendingCleanup) return;
      cleanupReported = true;
      notify(() => events.error(messages.cleanup));
    });
  };
  const release = (callback: () => void | Promise<void>) => {
    try {
      const pending = callback();
      if (pending) {
        pendingCleanup++;
        void pending.then(() => {
          pendingCleanup--;
          scheduleCleanupReport();
        }, () => {
          cleanupFailed = true;
          pendingCleanup--;
          scheduleCleanupReport();
        });
      }
    } catch {
      cleanupFailed = true;
      scheduleCleanupReport();
    }
  };
  const revokeModule = () => {
    if (moduleUrl === undefined) return;
    const url = moduleUrl;
    moduleUrl = undefined;
    release(() => URL.revokeObjectURL(url));
  };
  const clearPlayback = () => {
    for (const source of playback) {
      source.onended = null;
      release(() => source.stop());
      release(() => source.disconnect());
    }
    playback.clear();
    playbackUntil = audio?.currentTime ?? 0;
  };
  const activity = (value: boolean) => {
    if (speaking === value) return;
    speaking = value;
    if (value) clearPlayback();
    notify(() => events.activity?.(value));
  };
  const stopTracks = (value: MediaStream) => {
    for (const track of value.getTracks()) {
      release(() => track.removeEventListener("ended", microphoneEnded));
      release(() => track.stop());
    }
  };
  const shutdown = (error?: Error, report = false) => {
    if (isClosed()) return;
    state = "closed";
    terminalError = error ?? new DOMException("GPT-live session closed.", "AbortError");
    clearTimeout(startupTimer);
    clearTimeout(deadlineTimer);
    signal.removeEventListener("abort", abort);
    request.abort();
    rejectCancelled(terminalError);
    rejectStart?.(terminalError);
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      release(() => socket?.close(1000));
    }
    if (stream) stopTracks(stream);
    if (worklet) {
      worklet.onprocessorerror = null;
      worklet.port.onmessage = null;
      release(() => worklet?.port.postMessage({ type: "stop" }));
      release(() => worklet?.port.close());
      release(() => worklet?.disconnect());
    }
    release(() => input?.disconnect());
    release(() => mute?.disconnect());
    clearPlayback();
    if (audio) {
      audio.onstatechange = null;
      release(() => audio?.close());
    }
    revokeModule();
    activity(false);
    if (report) {
      const message = terminalError.message;
      notify(() => events.error(message));
    }
    notify(() => events.ended());
  };
  const fail = (message: string) => shutdown(new LiveError(message), true);
  const abort = () => shutdown(new DOMException("GPT-live session cancelled.", "AbortError"));
  const microphoneEnded = () => fail(messages.microphone);
  const wait = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, cancelled]);
  const send = (value: object) => {
    if (state !== "ready" || !socket) return;
    try {
      const payload = JSON.stringify(value);
      if (socket.readyState !== WebSocket.OPEN) throw new LiveError(messages.socket);
      if (socket.bufferedAmount + new TextEncoder().encode(payload).length > MAX_SOCKET_BUFFER) {
        throw new LiveError(messages.buffering);
      }
      socket.send(payload);
    } catch (error) {
      fail(error instanceof LiveError ? error.message : messages.socket);
    }
  };
  const append = (type: string, content: string, delegationId: string) => {
    if (state !== "ready") return;
    if (!boundedText(content, MAX_APPEND_BYTES)) {
      fail(messages.content);
      return;
    }
    if (!validId(delegationId)) { fail(messages.delegation); return; }
    if (!content.trim()) return;
    send({ type, content, delegation_id: delegationId });
  };
  const play = (encoded: string) => {
    const samples = decodeLivePcmAudio(encoded);
    if (speaking || !audio) return;
    if (audio.state !== "running") throw new LiveError(messages.autoplay);
    const at = Math.max(audio.currentTime + 0.01, playbackUntil);
    const until = at + samples.length / 16_000;
    if (until - audio.currentTime > MAX_PLAYBACK_SECONDS || playback.size >= MAX_PLAYBACK_NODES) {
      throw new LiveError(messages.buffering);
    }
    const buffer = audio.createBuffer(1, samples.length, 16_000);
    buffer.getChannelData(0).set(samples);
    const source = audio.createBufferSource();
    playback.add(source);
    source.buffer = buffer;
    source.onended = () => {
      if (!playback.delete(source)) return;
      release(() => source.disconnect());
      if (!playback.size) playbackUntil = audio?.currentTime ?? 0;
    };
    source.connect(audio.destination);
    source.start(at);
    playbackUntil = until;
  };
  const receive = (message: MessageEvent<unknown>) => {
    if (isClosed()) return;
    try {
      if (!boundedText(message.data, MAX_EVENT_BYTES)) throw new LiveError(messages.event);
      const event: unknown = JSON.parse(message.data);
      if (!record(event) || typeof event.type !== "string" || event.type.length > 128) {
        throw new LiveError(messages.event);
      }
      if (event.type === "tandem.live.error") {
        fail(sketchLiveFailureMessage(event.code) ?? messages.provider);
        return;
      }
      if (event.type === "session.closed") {
        if (state !== "ready") fail(messages.socket);
        else shutdown();
        return;
      }
      if (event.type === "session.started") {
        if (state === "ready") return;
        if (state !== "starting" || !worklet) throw new LiveError(messages.event);
        state = "ready";
        clearTimeout(startupTimer);
        worklet.port.postMessage({ type: "start" });
        resolveStart?.();
        return;
      }
      if (event.type === "session.output_audio.delta") {
        if (state !== "ready" || typeof event.delta !== "string") throw new LiveError(messages.event);
        play(event.delta);
      } else if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
        if (state !== "ready" || !boundedText(event.delta, MAX_TRANSCRIPT_BYTES)
          || !validOffset(event.start_ms) || !validOffset(event.end_ms) || event.end_ms < event.start_ms) {
          throw new LiveError(messages.event);
        }
        const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
        const { delta, start_ms: start, end_ms: end } = event;
        notify(() => events.transcript(role, delta, start, end));
      } else if (event.type === "session.delegation.created") {
        const delegation = event.delegation;
        if (state !== "ready" || !record(delegation) || delegation.type !== "delegation"
          || delegation.target !== "client" || !validId(delegation.id) || !validOffset(event.offset_ms)) {
          throw new LiveError(messages.event);
        }
        const { id } = delegation;
        const offset = event.offset_ms;
        notify(() => events.delegation(id, offset));
      } else if (!event.type.startsWith("session.")) {
        throw new LiveError(messages.event);
      }
      // Usage and future session metadata carry no browser-side action.
    } catch (error) {
      fail(error instanceof LiveError ? error.message : messages.event);
    }
  };

  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  if (isClosed()) throw terminalError;
  startupTimer = setTimeout(() => fail(messages.startup), STARTUP_MS);
  deadlineTimer = setTimeout(() => shutdown(), MAX_SESSION_MS);
  try {
    let context: string[];
    try { context = readSketchLiveInitialContext(initialContext); }
    catch { throw new LiveError(messages.initialContext); }
    const origin = new URL(location.href);
    if (!["http:", "https:"].includes(origin.protocol)
      || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) {
      throw new LiveError(messages.origin);
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined"
      || typeof AudioWorkletNode === "undefined") {
      throw new LiveError(messages.unsupported);
    }
    audio = new AudioContext({ latencyHint: "interactive" });
    if (!audio.audioWorklet?.addModule) throw new LiveError(messages.unsupported);
    audio.onstatechange = () => {
      if (watchAudioState && !isClosed() && audio?.state !== "running") fail(messages.autoplay);
    };
    // Both calls happen before the first await; resume must retain user activation.
    const resumed = audio.resume().catch(() => { throw new LiveError(messages.autoplay); });
    void resumed.catch(() => {});
    const media = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    }).then((value) => {
      if (isClosed()) stopTracks(value);
      else {
        stream = value;
        for (const track of value.getTracks()) {
          track.addEventListener("ended", microphoneEnded);
          if (track.readyState === "ended") fail(messages.microphone);
        }
      }
      return value;
    }, (error: unknown) => {
      const denied = record(error) && (error.name === "NotAllowedError" || error.name === "SecurityError");
      throw new LiveError(denied ? messages.permission : messages.microphone);
    });
    void media.catch(() => {});
    moduleUrl = URL.createObjectURL(new Blob([sketchLiveInputWorklet()], { type: "text/javascript" }));
    const loaded = audio.audioWorklet.addModule(moduleUrl)
      .catch(() => { throw new LiveError(messages.unsupported); }).finally(revokeModule);
    const [, acquired] = await wait(Promise.all([resumed, media, loaded]));
    if (isClosed()) throw terminalError;
    if (audio.state !== "running") throw new LiveError(messages.autoplay);
    watchAudioState = true;
    worklet = new AudioWorkletNode(audio, "tandem-sketch-live-input", {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1,
      channelCountMode: "explicit", outputChannelCount: [1],
    });
    worklet.onprocessorerror = () => fail(messages.audio);
    worklet.port.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (isClosed()) return;
      try {
        if (!record(data) || data.type !== "frame" || !(data.audio instanceof ArrayBuffer)
          || data.audio.byteLength !== 640 || typeof data.speaking !== "boolean"
          || typeof data.sequence !== "number" || !Number.isSafeInteger(data.sequence)
          || data.sequence <= lastFrameSequence) {
          throw new LiveError(messages.buffering);
        }
        lastFrameSequence = data.sequence;
        worklet?.port.postMessage({ type: "ack", sequence: data.sequence });
        if (state !== "ready") return;
        activity(data.speaking);
        send({ type: "session.input_audio.append", audio: encodeLivePcmFrame(data.audio) });
      } catch (error) {
        fail(error instanceof LiveError ? error.message : messages.audio);
      }
    };
    input = audio.createMediaStreamSource(acquired);
    mute = audio.createGain();
    mute.gain.value = 0;
    input.connect(worklet);
    worklet.connect(mute);
    mute.connect(audio.destination);
    state = "prepared";

    const connect = async () => {
      let response: Response;
      try {
        response = await wait(fetch("/api/sketch/live/session", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Tandem-Speech": "1" },
          body: context.length ? JSON.stringify({ context }) : "{}", cache: "no-store", credentials: "same-origin",
          mode: "same-origin", redirect: "error", signal: request.signal,
        }));
      } catch {
        throw new LiveError(messages.proxy);
      }
      if (isClosed()) return;
      if (!response.ok) throw new LiveError(messages.proxy);
      let value: unknown;
      try { value = await wait(response.json()); }
      catch { throw new LiveError(messages.response); }
      if (isClosed()) return;
      if (!record(value) || typeof value.ticket !== "string"
        || !/^[A-Za-z0-9._~-]{1,2048}$/.test(value.ticket)
        || value.path !== "/api/sketch/live/socket"
        || typeof value.maxDurationSeconds !== "number" || !Number.isInteger(value.maxDurationSeconds)
        || value.maxDurationSeconds < 1 || value.maxDurationSeconds > 600) {
        throw new LiveError(messages.response);
      }
      clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(() => shutdown(), Math.min(deadline - Date.now(), value.maxDurationSeconds * 1_000));
      const url = new URL(value.path, origin.origin);
      url.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", value.ticket);
      try { socket = new WebSocket(url.href); }
      catch { throw new LiveError(messages.socket); }
      socket.onmessage = receive;
      socket.onerror = () => fail(messages.socket);
      socket.onclose = () => fail(messages.socket);
    };

    return {
      start() {
        if (isClosed()) return Promise.reject(terminalError);
        if (startPromise) return startPromise;
        state = "starting";
        startPromise = new Promise<void>((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
        void connect().catch((error: unknown) => {
          if (!isClosed()) fail(error instanceof LiveError ? error.message : messages.proxy);
        });
        return startPromise;
      },
      close: () => shutdown(),
      context: (content, id) => append("session.thinking.append", content, id),
      commentary: (content, id) => append("session.commentary.append", content, id),
    };
  } catch (error) {
    if (!isClosed()) fail(error instanceof LiveError ? error.message : messages.audio);
    throw terminalError;
  }
};
