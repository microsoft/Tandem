export interface SpeechSession {
  start(): Promise<void>;
  stop(): Promise<void>;
  close(): void;
}

export interface SpeechEvents {
  transcript(text: string, final: boolean): void;
  error(message: string): void;
  ended(): void;
}

export type SpeechSessionFactory = (
  events: SpeechEvents,
  signal: AbortSignal,
) => Promise<SpeechSession>;

interface SpeechToken {
  authorizationToken: string;
  region: string;
  language: string;
  expiresAt: number;
}

async function requestToken(signal: AbortSignal): Promise<SpeechToken> {
  const response = await fetch("/api/speech/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tandem-Speech": "1" },
    body: "{}",
    cache: "no-store",
    signal,
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || "Azure Speech authentication failed."),
    { speechSignInRequired: value.speechSignInRequired === true });
  if (typeof value.authorizationToken !== "string" || !value.authorizationToken.startsWith("aad#")
    || typeof value.region !== "string" || typeof value.language !== "string"
    || !Number.isFinite(value.expiresAt) || value.expiresAt < Date.now() + 150_000) {
    throw new Error("Azure Speech returned an invalid or expiring token. Sign in again and retry.");
  }
  return value;
}

export const createAzureSpeechSession: SpeechSessionFactory = async (events, signal) => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is unavailable here. Open Tandem in a browser that allows microphone access.");
  }
  const token = await requestToken(signal);
  const sdk = await import("microsoft-cognitiveservices-speech-sdk");
  signal.throwIfAborted();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) {
      throw new Error("Allow microphone access in the app and Windows privacy settings. If the canvas blocks it, open Tandem in your browser.");
    }
    throw new Error("Could not open the microphone. Connect an input device, close apps using it, and retry.");
  }
  if (signal.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    signal.throwIfAborted();
  }
  let audio: import("microsoft-cognitiveservices-speech-sdk").AudioConfig | undefined;
  let recognizer: import("microsoft-cognitiveservices-speech-sdk").SpeechRecognizer;
  try {
    const config = sdk.SpeechConfig.fromAuthorizationToken(token.authorizationToken, token.region);
    config.speechRecognitionLanguage = token.language;
    // Do not upload SDK diagnostic audio or transcript telemetry.
    sdk.SpeechRecognizer.enableTelemetry(false);
    audio = sdk.AudioConfig.fromStreamInput(stream);
    recognizer = new sdk.SpeechRecognizer(config, audio);
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    audio?.close();
    throw new Error("Could not initialize Azure Speech. Check your browser's audio support and retry.");
  }
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    stream.getTracks().forEach((track) => track.stop());
    recognizer.close(undefined, () => events.error("Could not close the speech connection. The microphone has been released."));
    audio.close();
  };
  signal.addEventListener("abort", close, { once: true });
  recognizer.recognizing = (_, event) => {
    if (!closed) events.transcript(event.result.text, false);
  };
  recognizer.recognized = (_, event) => {
    if (!closed && event.result.reason === sdk.ResultReason.RecognizedSpeech) {
      events.transcript(event.result.text, true);
    }
  };
  recognizer.canceled = (_, event) => {
    if (closed) return;
    if (event.reason === sdk.CancellationReason.Error) {
      events.error("Azure Speech recognition failed. Check your connection, Speech resource permissions, and configured language, then retry.");
    } else {
      events.ended();
    }
  };
  recognizer.sessionStopped = () => { if (!closed) events.ended(); };
  return {
    start: () => new Promise<void>((resolve, reject) => {
      recognizer.startContinuousRecognitionAsync(resolve, () => reject(
        new Error("Could not start Azure Speech. Check microphone access, Azure sign-in, and your connection."),
      ));
    }),
    stop: () => new Promise<void>((resolve, reject) => {
      recognizer.stopContinuousRecognitionAsync(resolve, () => reject(
        new Error("Could not finish speech capture. Your original draft has been restored; retry recording."),
      ));
    }),
    close,
  };
};
