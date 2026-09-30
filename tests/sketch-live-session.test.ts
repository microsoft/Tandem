import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { createPcm16FrameEncoder, decodeLivePcmAudio, encodeLivePcmFrame, sketchLiveInputWorklet } from "../src/renderer/sketch-live-audio.js";
import type { SketchLiveEvents, SketchLiveSessionFactory } from "../src/renderer/sketch-live-session.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function pcm(samples = 320, value = 0.25) {
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++) buffer.writeInt16LE(Math.round(value * 32_767), index * 2);
  return buffer.toString("base64");
}

let compiled: Promise<string> | undefined;
async function compile() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/renderer/sketch-live-session.ts", import.meta.url))],
    bundle: true, write: false, format: "cjs", platform: "browser", target: "es2020",
    minify: true, logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

async function fixture() {
  const settings = {
    origin: "http://127.0.0.1:4312/sketch",
    media: undefined as Promise<unknown> | undefined,
    resume: undefined as Promise<void> | undefined,
    module: undefined as Promise<void> | undefined,
    fetch: undefined as Promise<unknown> | undefined,
    resumeState: "running",
    unsupported: false,
    noMicrophone: false,
    failNode: false,
    failSource: false,
    failSocket: false,
    failSend: false,
    failTrackStop: false,
    failPlaybackStop: false,
    failDisconnect: false,
    failSocketClose: false,
    failPortClose: false,
    failAudioClose: false,
    audioClose: undefined as Promise<void> | undefined,
    responseOk: true,
    response: { ticket: "private-ticket", path: "/api/sketch/live/socket", maxDurationSeconds: 600 } as unknown,
  };
  const requests: { url: string; options: RequestInit }[] = [];
  const constraints: MediaStreamConstraints[] = [];
  const urls: { source: Blob; url: string }[] = [];
  const revoked: string[] = [];
  const moduleUrls: string[] = [];
  const transcripts: [string, string, number, number][] = [];
  const delegations: [string, number][] = [];
  const errors: string[] = [];
  const diagnostics: unknown[][] = [];
  const activities: boolean[] = [];
  const timers = new Map<number, { at: number; callback: () => void }>();
  let nextTimer = 0;
  let now = 0;
  let ended = 0;
  let stopped = 0;
  const track = new EventTarget();
  const stream = {
    getTracks: () => [Object.assign(track, {
      stop() {
        stopped++;
        if (settings.failTrackStop) throw new Error("private track failure");
      },
    })],
  };
  class Port {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    sent: any[] = [];
    closed = 0;
    postMessage(data: unknown) { this.sent.push(data); }
    close() {
      this.closed++;
      if (settings.failPortClose) throw new Error("private port failure");
    }
    emit(data: unknown) { this.onmessage?.({ data }); }
  }
  class Node {
    connected: unknown[] = [];
    disconnected = 0;
    connect(node: unknown) { this.connected.push(node); }
    disconnect() {
      this.disconnected++;
      if (settings.failDisconnect) throw new Error("private disconnect failure");
    }
  }
  class Source extends Node {
    buffer: { channels: number; sampleRate: number; samples: Float32Array } | undefined;
    onended: (() => void) | null = null;
    starts: number[] = [];
    stopped = 0;
    start(time: number) { this.starts.push(time); }
    stop() {
      this.stopped++;
      if (settings.failPlaybackStop) throw new Error("private playback failure");
    }
  }
  const audios: Audio[] = [];
  class Audio {
    sampleRate = 48_000;
    currentTime = 0;
    state = "suspended";
    destination = {};
    onstatechange: (() => void) | null = null;
    sources: Source[] = [];
    input = new Node();
    gain = Object.assign(new Node(), { gain: { value: 1 } });
    closed = 0;
    resumed = 0;
    media: unknown;
    audioWorklet = {
      addModule: (url: string) => {
        moduleUrls.push(url);
        return settings.module ?? Promise.resolve();
      },
    };
    constructor() { audios.push(this); }
    resume() { this.resumed++; this.state = settings.resumeState; return settings.resume ?? Promise.resolve(); }
    close() {
      this.closed++;
      this.state = "closed";
      if (settings.failAudioClose) throw new Error("private audio close failure");
      return settings.audioClose ?? Promise.resolve();
    }
    createMediaStreamSource(value: unknown) { this.media = value; return this.input; }
    createGain() { return this.gain; }
    createBuffer(channels: number, length: number, sampleRate: number) {
      const samples = new Float32Array(length);
      return { channels, sampleRate, samples, getChannelData: () => samples };
    }
    createBufferSource() {
      if (settings.failSource) throw new Error("private device error");
      const source = new Source();
      this.sources.push(source);
      return source;
    }
  }
  const worklets: Worklet[] = [];
  class Worklet extends Node {
    port = new Port();
    onprocessorerror: (() => void) | null = null;
    constructor(public audio: Audio, public name: string, public options: unknown) {
      super();
      if (settings.failNode) throw new Error("private worklet error");
      worklets.push(this);
    }
  }
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 0;
    bufferedAmount = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    sent: any[] = [];
    closed = 0;
    constructor(public url: string) {
      if (settings.failSocket) throw new Error("private-ticket");
      sockets.push(this);
    }
    open() { this.readyState = 1; this.onopen?.(); }
    emit(value: unknown) { this.raw(JSON.stringify(value)); }
    raw(data: unknown) { this.onmessage?.({ data }); }
    send(value: string) {
      if (settings.failSend) throw new Error("private-ticket");
      this.sent.push(JSON.parse(value));
    }
    close() {
      this.closed++;
      this.readyState = 3;
      if (settings.failSocketClose) throw new Error("private socket failure");
      this.onclose?.();
    }
    disconnect() { this.readyState = 3; this.onclose?.(); }
  }
  class BrowserURL extends URL {
    static createObjectURL(source: Blob) {
      const url = `blob:worklet-${urls.length}`;
      urls.push({ source, url });
      return url;
    }
    static revokeObjectURL(url: string) { revoked.push(url); }
  }
  const context = {
    module: { exports: {} }, exports: {}, Error, DOMException, Blob, queueMicrotask,
    console: { error: (...values: unknown[]) => { diagnostics.push(values); } },
    ArrayBuffer, Float32Array, DataView, TextEncoder, AbortController,
    atob, btoa, URL: BrowserURL,
    Date: { now: () => now },
    location: { get href() { return settings.origin; } },
    get AudioContext() { return settings.unsupported ? undefined : Audio; },
    AudioWorkletNode: Worklet,
    WebSocket: Socket,
    navigator: {
      get mediaDevices() {
        if (settings.noMicrophone) return undefined;
        return {
          getUserMedia(value: MediaStreamConstraints) {
            constraints.push(value);
            return settings.media ?? Promise.resolve(stream);
          },
        };
      },
    },
    fetch: (url: string, options: RequestInit) => {
      requests.push({ url, options });
      return settings.fetch ?? Promise.resolve({ ok: settings.responseOk, json: async () => settings.response });
    },
    setTimeout(callback: () => void, milliseconds: number) {
      const id = ++nextTimer;
      timers.set(id, { at: now + milliseconds, callback });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
  };
  runInNewContext(await (compiled ??= compile()), context);
  const create = (context.module.exports as { createSketchLiveSession: SketchLiveSessionFactory }).createSketchLiveSession;
  const events: SketchLiveEvents = {
    transcript: (role, text, start, end) => { transcripts.push([role, text, start, end]); },
    delegation: (id, offset) => { delegations.push([id, offset]); },
    error: (message) => { errors.push(message); },
    ended: () => { ended++; },
    activity: (speaking) => { activities.push(speaking); },
  };
  const abort = new AbortController();
  return {
    create: (initialContext?: readonly string[]) => create(events, abort.signal, initialContext),
    async ready() {
      const session = await create(events, abort.signal);
      const started = session.start();
      await flush();
      sockets[0].open();
      sockets[0].emit({ type: "session.started" });
      await started;
      return session;
    },
    frame(speaking = false, sequence = 1) {
      worklets[0].port.emit({ type: "frame", audio: new ArrayBuffer(640), speaking, sequence });
    },
    advance(milliseconds: number) {
      const until = now + milliseconds;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = until;
    },
    stats: () => ({ ended, stopped }),
    settings, sockets, worklets, audios, requests, constraints, urls, revoked, moduleUrls,
    transcripts, delegations, errors, diagnostics, activities, timers, stream, track, abort, events,
  };
}

test("live PCM resampling retains exact 20 ms frame boundaries across native sample rates", () => {
  for (const rate of [8_000, 16_000, 44_100, 48_000, 96_000]) {
    const frames: ArrayBuffer[] = [];
    const encoder = createPcm16FrameEncoder(rate, (frame) => frames.push(frame));
    const input = new Float32Array(rate).fill(0.25);
    for (let offset = 0; offset < input.length; offset += 127) encoder.push(input.subarray(offset, offset + 127));
    assert.equal(frames.length, 50, `one second at ${rate}`);
    assert.ok(frames.every((frame) => frame.byteLength === 640));
    assert.ok(frames.every((frame) => new DataView(frame).getInt16(0, true) === 8_192));
  }
});

test("live PCM conversion is little endian, clips safely, and never flushes a partial frame", () => {
  const frames: ArrayBuffer[] = [];
  const encoder = createPcm16FrameEncoder(16_000, (frame) => frames.push(frame));
  const samples = new Float32Array(319);
  samples.set([-2, 2, NaN, Infinity, -0.5, 0.5]);
  encoder.push(samples);
  assert.equal(frames.length, 0);
  encoder.push(new Float32Array(1));
  assert.equal(frames.length, 1);
  assert.deepEqual([...new Uint8Array(frames[0]).subarray(0, 4)], [0, 128, 255, 127]);
  const words = Array.from({ length: 6 }, (_, index) => new DataView(frames[0]).getInt16(index * 2, true));
  assert.deepEqual(words, [-32_768, 32_767, 0, 0, -16_384, 16_384]);
  encoder.push(new Float32Array(320).fill(1));
  assert.notEqual(frames[0], frames[1]);
  assert.equal(new DataView(frames[0]).getInt16(0, true), -32_768);
  assert.throws(() => encoder.push(new Float32Array(4_097)), /quantum/);
  assert.throws(() => createPcm16FrameEncoder(0, () => {}), /sample rate/);
});

test("live PCM downsampling averages source intervals and is independent of input chunking", () => {
  const source = Float32Array.from({ length: 44_100 }, (_, index) => Math.sin(index * 0.12));
  const convert = (chunk: number) => {
    const frames: ArrayBuffer[] = [];
    const encoder = createPcm16FrameEncoder(44_100, (frame) => frames.push(frame));
    for (let offset = 0; offset < source.length; offset += chunk) encoder.push(source.subarray(offset, offset + chunk));
    return Buffer.concat(frames.map((frame) => Buffer.from(frame)));
  };
  assert.deepEqual(convert(128), convert(881));
  const frames: ArrayBuffer[] = [];
  createPcm16FrameEncoder(48_000, (frame) => frames.push(frame))
    .push(Float32Array.from({ length: 960 }, (_, index) => [-1, 0, 1][index % 3]));
  assert.ok([...new Uint8Array(frames[0])].every((byte) => byte === 0));
});

test("live PCM base64 codec rejects malformed, odd, noncanonical and oversized audio", () => {
  const frame = new ArrayBuffer(640);
  new DataView(frame).setInt16(0, -32_768, true);
  assert.equal(decodeLivePcmAudio(encodeLivePcmFrame(frame))[0], -1);
  assert.equal(decodeLivePcmAudio(pcm(1, 1))[0], 32_767 / 32_768);
  for (const invalid of ["", "secret!", "AA==", "AAAAA", "AAB=", pcm(16_001)]) {
    assert.throws(() => decodeLivePcmAudio(invalid));
  }
  assert.throws(() => encodeLivePcmFrame(new ArrayBuffer(2)));
});

function workletFixture(source: string) {
  let Constructor: any;
  const sent: any[] = [];
  class Processor {
    port = { onmessage: null as any, postMessage: (value: unknown) => sent.push(value) };
  }
  runInNewContext(source, {
    AudioWorkletProcessor: Processor, sampleRate: 48_000,
    registerProcessor(name: string, value: unknown) {
      assert.equal(name, "tandem-sketch-live-input");
      Constructor = value;
    },
  });
  const processor = new Constructor();
  const input = [[new Float32Array(960).fill(0.2)]];
  return { processor, sent, process: () => processor.process(input) };
}

test("live worklet waits for start, caps transferred frames, acknowledges credit and stops", () => {
  const h = workletFixture(sketchLiveInputWorklet());
  h.process();
  assert.equal(h.sent.length, 0);
  h.processor.port.onmessage({ data: { type: "start" } });
  for (let index = 0; index < 16; index++) h.process();
  assert.equal(h.sent.length, 16);
  assert.ok(h.sent.every((frame) => frame.audio.byteLength === 640 && frame.speaking));
  h.processor.port.onmessage({ data: { type: "ack", sequence: 1 } });
  h.process();
  assert.equal(h.sent[16].sequence, 17);
  h.process();
  assert.equal(h.sent[17].type, "overflow");
  h.process();
  assert.equal(h.sent.length, 18);
  h.processor.port.onmessage({ data: { type: "stop" } });
  h.process();
  assert.equal(h.sent.length, 18);
});

test("live worklet survives the actual ES2020 minified browser bundle", async () => {
  const h = await fixture();
  const session = await h.create();
  const worker = workletFixture(await h.urls[0].source.text());
  worker.processor.port.onmessage({ data: { type: "start" } });
  worker.process();
  assert.equal(worker.sent[0].audio.byteLength, 640);
  assert.deepEqual(h.revoked, ["blob:worklet-0"]);
  session.close();
});

test("live session uses only local startup/socket protocol and waits for session.started", async () => {
  const h = await fixture();
  const creating = h.create();
  assert.equal(h.audios[0].resumed, 1, "resume runs in the user-activation turn");
  assert.equal(h.constraints.length, 1);
  const session = await creating;
  assert.equal(h.requests.length, 0);
  session.context("do not send yet");
  const started = session.start();
  assert.equal(session.start(), started);
  let ready = false;
  void started.then(() => { ready = true; });
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "/api/sketch/live/session");
  const options = h.requests[0].options;
  assert.equal(options.method, "POST");
  assert.equal(options.body, "{}");
  assert.deepEqual(JSON.parse(JSON.stringify(options.headers)), { "Content-Type": "application/json", "X-Tandem-Speech": "1" });
  assert.equal(options.redirect, "error");
  assert.equal(options.mode, "same-origin");
  assert.equal(h.sockets[0].url, "ws://127.0.0.1:4312/api/sketch/live/socket?ticket=private-ticket");
  h.sockets[0].open();
  await flush();
  assert.equal(ready, false);
  assert.equal(h.worklets[0].port.sent.length, 0);
  h.sockets[0].emit({ type: "session.started" });
  await started;
  assert.equal(h.worklets[0].port.sent[0].type, "start");
  assert.deepEqual(h.sockets[0].sent, []);
  assert.deepEqual(JSON.parse(JSON.stringify(h.constraints[0])), {
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  h.frame();
  assert.equal(h.sockets[0].sent[0].type, "session.input_audio.append");
  assert.equal(Buffer.from(h.sockets[0].sent[0].audio, "base64").byteLength, 640);
  session.context("Current draft", "delegation-1");
  session.commentary("Updating the drawing", "delegation-1");
  assert.deepEqual(h.sockets[0].sent.slice(1), [
    { type: "session.thinking.append", content: "Current draft", delegation_id: "delegation-1" },
    { type: "session.commentary.append", content: "Updating the drawing", delegation_id: "delegation-1" },
  ]);
  session.close();
});

test("live transcripts and delegation identities are forwarded as deltas without deduplication", async () => {
  const h = await fixture();
  const session = await h.ready();
  for (let repeat = 0; repeat < 2; repeat++) {
    h.sockets[0].emit({ type: "session.input_transcript.delta", delta: "hel", start_ms: 1, end_ms: 3 });
  }
  h.sockets[0].emit({ type: "session.output_transcript.delta", delta: "Hello", start_ms: 3, end_ms: 9.5 });
  h.sockets[0].emit({
    type: "session.delegation.created",
    delegation: { type: "delegation", target: "client", id: "delegation:2" }, offset_ms: 10,
  });
  h.sockets[0].emit({ type: "session.usage", usage: { tokens: 12 } });
  assert.deepEqual(h.transcripts, [["user", "hel", 1, 3], ["user", "hel", 1, 3], ["assistant", "Hello", 3, 9.5]]);
  assert.deepEqual(h.delegations, [["delegation:2", 10]]);
  assert.deepEqual(h.errors, []);
  session.close();
});

test("live playback is mono 16 kHz and barge-in clears output without disabling capture", async () => {
  const h = await fixture();
  const session = await h.ready();
  h.sockets[0].emit({ type: "session.output_audio.delta", delta: pcm() });
  h.sockets[0].emit({ type: "session.output_audio.delta", delta: pcm() });
  assert.equal(h.audios[0].sources.length, 2);
  const [first, second] = h.audios[0].sources;
  assert.equal(first.buffer?.sampleRate, 16_000);
  assert.equal(first.buffer?.channels, 1);
  assert.ok(second.starts[0] > first.starts[0]);
  h.frame(true);
  assert.equal(first.stopped, 1);
  assert.equal(second.stopped, 1);
  assert.equal(first.disconnected, 1);
  assert.equal(h.stats().stopped, 0);
  assert.equal(h.sockets[0].sent[0].type, "session.input_audio.append");
  h.sockets[0].emit({ type: "session.output_audio.delta", delta: pcm() });
  assert.equal(h.audios[0].sources.length, 2, "old output is suppressed while user speaks");
  h.frame(false, 2);
  h.sockets[0].emit({ type: "session.output_audio.delta", delta: pcm() });
  assert.equal(h.audios[0].sources.length, 3);
  assert.deepEqual(h.activities, [true, false]);
  session.close();
});

test("live cleanup is idempotent and ignores late output, frame and socket events", async () => {
  const h = await fixture();
  const session = await h.ready();
  h.sockets[0].emit({ type: "session.output_audio.delta", delta: pcm() });
  const lateSocket = h.sockets[0].onmessage!;
  const lateFrame = h.worklets[0].port.onmessage!;
  session.close();
  session.close();
  h.abort.abort();
  lateSocket({ data: JSON.stringify({ type: "session.output_audio.delta", delta: pcm() }) });
  lateFrame({ data: { type: "frame", audio: new ArrayBuffer(640), speaking: true, sequence: 1 } });
  session.context("late");
  assert.deepEqual(h.stats(), { ended: 1, stopped: 1 });
  assert.equal(h.audios[0].closed, 1);
  assert.equal(h.audios[0].input.disconnected, 1);
  assert.equal(h.audios[0].gain.disconnected, 1);
  assert.equal(h.audios[0].sources[0].stopped, 1);
  assert.equal(h.worklets[0].disconnected, 1);
  assert.equal(h.worklets[0].port.closed, 1);
  assert.equal(h.sockets[0].closed, 1);
  assert.equal(h.audios[0].sources.length, 1);
  assert.equal(h.sockets[0].sent.length, 0);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.errors, []);
  await assert.rejects(session.start(), { name: "AbortError" });
});

test("live pending microphone abort rejects promptly and releases a subsequently granted stream", async () => {
  const h = await fixture();
  const media = deferred<unknown>();
  h.settings.media = media.promise;
  const creating = h.create();
  const rejected = assert.rejects(creating, { name: "AbortError" });
  h.abort.abort();
  await rejected;
  assert.equal(h.stats().stopped, 0);
  assert.equal(h.audios[0].closed, 1);
  media.resolve(h.stream);
  await flush();
  assert.equal(h.stats().stopped, 1);
  assert.equal(h.worklets.length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.stats().ended, 1);
  assert.deepEqual(h.errors, []);
});

test("live permission and autoplay failures are visible, safe and release acquired resources", async () => {
  for (const mode of ["permission", "autoplay", "suspended", "worklet"] as const) {
    const h = await fixture();
    if (mode === "permission") h.settings.media = Promise.reject(new DOMException("private-token", "NotAllowedError"));
    if (mode === "autoplay") h.settings.resume = Promise.reject(new Error("private-token"));
    if (mode === "suspended") h.settings.resumeState = "suspended";
    if (mode === "worklet") h.settings.failNode = true;
    await assert.rejects(h.create(), mode === "permission" ? /Allow microphone/ : mode === "worklet" ? /browser audio/ : /Allow sound/);
    assert.equal(h.audios[0].closed, 1);
    assert.equal(h.stats().stopped, mode === "permission" ? 0 : 1);
    assert.equal(h.errors.length, 1);
    assert.doesNotMatch(h.errors[0], /private-token/);
    assert.equal(h.stats().ended, 1);
    assert.equal(h.timers.size, 0);
  }
});

test("live startup timeout bounds unresolved permission, resume and worklet initialization", async () => {
  for (const pending of ["media", "module", "resume"] as const) {
    const h = await fixture();
    const gate = deferred<any>();
    h.settings[pending] = gate.promise;
    const creating = h.create();
    const rejected = assert.rejects(creating, /20 seconds/);
    h.advance(20_000);
    await rejected;
    gate.resolve(pending === "media" ? h.stream : undefined);
    await flush();
    assert.equal(h.audios[0].closed, 1);
    assert.equal(h.stats().stopped, 1);
    assert.deepEqual(h.revoked, ["blob:worklet-0"]);
    assert.equal(h.timers.size, 0);
  }
});

test("live abort or close during fetch cannot create a socket after startup resolves", async () => {
  for (const cancel of ["abort", "close"] as const) {
    const h = await fixture();
    const response = deferred<unknown>();
    h.settings.fetch = response.promise;
    const session = await h.create();
    const started = session.start();
    const rejected = assert.rejects(started, { name: "AbortError" });
    if (cancel === "abort") h.abort.abort();
    else session.close();
    await rejected;
    assert.equal(h.requests[0].options.signal?.aborted, true);
    response.resolve({ ok: true, json: async () => h.settings.response });
    await flush();
    assert.equal(h.sockets.length, 0);
    assert.equal(h.stats().stopped, 1);
    assert.deepEqual(h.errors, []);
  }
});

test("live ready handshake timeout, premature close and socket failures close every resource", async () => {
  for (const failure of ["timeout", "close", "error", "provider"] as const) {
    const h = await fixture();
    const session = await h.create();
    const started = session.start();
    const rejected = assert.rejects(started);
    await flush();
    h.sockets[0].open();
    if (failure === "timeout") h.advance(20_000);
    if (failure === "close") h.sockets[0].disconnect();
    if (failure === "error") h.sockets[0].onerror?.();
    if (failure === "provider") h.sockets[0].emit({ type: "tandem.live.error", message: "private-token" });
    await rejected;
    assert.equal(h.errors.length, 1);
    assert.doesNotMatch(h.errors[0], /private-token/);
    assert.equal(h.sockets[0].closed, 1);
    assert.equal(h.stats().stopped, 1);
    assert.equal(h.timers.size, 0);
  }
});

test("live never connects to non-loopback or proxy-supplied external websocket addresses", async () => {
  const remote = await fixture();
  remote.settings.origin = "https://example.com";
  await assert.rejects(remote.create(), /localhost/);
  assert.equal(remote.constraints.length, 0);
  assert.equal(remote.requests.length, 0);
  for (const response of [
    { ticket: "t", path: "wss://cloudgpt-ins.openai.azure.com/openai/v1/live/sessions", maxDurationSeconds: 600 },
    { ticket: "private-token", path: "/api/sketch/live/socket", maxDurationSeconds: 601 },
    { ticket: "", path: "/api/sketch/live/socket", maxDurationSeconds: 600 },
  ]) {
    const h = await fixture();
    h.settings.response = response;
    const session = await h.create();
    await assert.rejects(session.start(), /invalid session response/);
    assert.equal(h.sockets.length, 0);
    assert.equal(h.stats().stopped, 1);
    assert.doesNotMatch(h.errors[0], /private-token/);
  }
  const secure = await fixture();
  secure.settings.origin = "https://localhost:1234";
  const session = await secure.ready();
  assert.match(secure.sockets[0].url, /^wss:\/\/localhost:1234\/api\/sketch\/live\/socket\?/);
  session.close();
});

test("live microphone transport and playback queues have hard limits", async () => {
  for (const mode of ["socket", "worklet", "playback", "nodes"] as const) {
    const h = await fixture();
    await h.ready();
    if (mode === "socket") { h.sockets[0].bufferedAmount = 65_000; h.frame(); }
    if (mode === "worklet") h.worklets[0].port.emit({ type: "overflow" });
    if (mode === "playback") {
      for (let index = 0; index < 4; index++) h.sockets[0].emit({ type: "session.output_audio.delta", delta: pcm(12_000) });
    }
    if (mode === "nodes") {
      for (let index = 0; index < 129; index++) h.sockets[0].emit({ type: "session.output_audio.delta", delta: pcm(1) });
    }
    assert.match(h.errors[0], /cannot keep up/);
    assert.equal(h.stats().stopped, 1);
    assert.equal(h.audios[0].closed, 1);
    assert.equal(h.sockets[0].closed, 1);
    assert.ok(h.audios[0].sources.every((source) => source.stopped === 1 && source.disconnected === 1));
  }
});

test("live context/commentary accept exactly 500 UTF-8 bytes and reject 501 without splitting or echoing input", async () => {
  for (const method of ["context", "commentary"] as const) {
    for (const content of ["a".repeat(500), "界".repeat(166) + "ab", "🎙".repeat(125)]) {
      const h = await fixture();
      const session = await h.ready();
      assert.equal(Buffer.byteLength(content, "utf8"), 500);
      session[method](content, "valid:id-1");
      assert.equal(h.sockets[0].sent.length, 1);
      assert.equal(h.sockets[0].sent[0].content, content);
      assert.deepEqual(h.errors, []);
      session[method](content + "x");
      assert.equal(h.sockets[0].sent.length, 1, "oversized input must not be split or partially sent");
      assert.match(h.errors[0], /500-byte UTF-8 limit/);
      assert.equal(h.errors[0].includes(content), false);
      assert.equal(h.stats().ended, 1);
    }
  }
});

test("live context/commentary reject invalid delegation IDs without echoing input", async () => {
  const h = await fixture();
  const session = await h.ready();
  session.context("sensitive content", "secret\ninvalid");
  assert.equal(h.sockets[0].sent.length, 0);
  assert.doesNotMatch(h.errors[0], /sensitive|secret/);
});

test("initial sketch context is sent with the ticket request and never appended without delegation", async () => {
  const h = await fixture();
  const context = ['{"kind":"screen","id":"home","title":"Home"}'];
  const session = await h.create(context);
  const starting = session.start();
  await flush();
  assert.deepEqual(JSON.parse(h.requests[0].options.body as string), { context });
  h.sockets[0].open();
  h.sockets[0].emit({ type: "session.started" });
  await starting;
  assert.deepEqual(h.sockets[0].sent, []);
  // Exercise the runtime guard, including an older caller with no ID.
  Reflect.apply(session.context, session, ["Unsolicited draft"]);
  assert.equal(h.sockets[0].sent.length, 0);
  assert.match(h.errors[0], /require a delegation ID/);
});

test("oversized or invalid initial context cannot start microphone capture", async () => {
  for (const context of [["not-json"], [JSON.stringify({ kind: "goal", text: "x".repeat(501) })]]) {
    const h = await fixture();
    await assert.rejects(h.create(context), /initial sketch context/);
    assert.equal(h.constraints.length, 0);
    assert.equal(h.requests.length, 0);
  }
});

test("known proxy failure codes explain the cause without trusting provider error text", async () => {
  for (const [code, expected] of [
    ["delegation_required", /required delegation ID/], ["authentication_failed", /Azure authentication/],
    ["access_denied", /HTTP 403/], ["protocol_rejected", /protocol message/], ["transport_failed", /network/],
    ["private-token", /could not continue/],
  ] as const) {
    const h = await fixture();
    await h.ready();
    h.sockets[0].emit({ type: "tandem.live.error", code, message: "private-token" });
    assert.match(h.errors[0], expected);
    assert.doesNotMatch(h.errors[0], /private-token/);
  }
});

test("live transcript deltas retain their independent 16 KiB UTF-8 limit", async () => {
  for (const role of ["input", "output"]) {
    for (const delta of ["a".repeat(16_384), "界".repeat(5_461) + "a"]) {
      const h = await fixture();
      await h.ready();
      assert.equal(Buffer.byteLength(delta, "utf8"), 16_384);
      h.sockets[0].emit({ type: `session.${role}_transcript.delta`, delta, start_ms: 0, end_ms: 1 });
      assert.equal(h.transcripts.length, 1);
      assert.equal(h.transcripts[0][1], delta);
      assert.deepEqual(h.errors, []);
      h.sockets[0].emit({ type: `session.${role}_transcript.delta`, delta: delta + "x", start_ms: 0, end_ms: 1 });
      assert.equal(h.transcripts.length, 1);
      assert.match(h.errors[0], /invalid event/);
    }
  }
});

test("live malformed events fail visibly without leaking raw event content", async () => {
  const invalid = [
    "private-token",
    "null",
    JSON.stringify({ type: "invalid-private-token" }),
    JSON.stringify({ type: "session.output_audio.delta", delta: "private-token" }),
    JSON.stringify({ type: "session.input_transcript.delta", delta: "secret", start_ms: 9, end_ms: 1 }),
    JSON.stringify({ type: "session.delegation.created", delegation: { id: "secret\n", type: "delegation", target: "client" }, offset_ms: 1 }),
    "x".repeat(65_537),
    new ArrayBuffer(640),
  ];
  for (const data of invalid) {
    const h = await fixture();
    await h.ready();
    h.sockets[0].raw(data);
    assert.match(h.errors[0], /invalid event/);
    assert.doesNotMatch(h.errors[0], /private-token|secret/);
    assert.equal(h.stats().stopped, 1);
    assert.equal(h.sockets[0].closed, 1);
  }
});

test("live session deadline and provider closure end cleanly without reconnect", async () => {
  for (const end of ["deadline", "provider", "shorter"] as const) {
    const h = await fixture();
    if (end === "shorter") h.settings.response = { ticket: "t", path: "/api/sketch/live/socket", maxDurationSeconds: 2 };
    const session = await h.ready();
    if (end === "provider") h.sockets[0].emit({ type: "session.closed" });
    else {
      h.advance(end === "shorter" ? 1_999 : 599_999);
      assert.equal(h.stats().ended, 0);
      h.advance(1);
    }
    assert.equal(h.stats().ended, 1);
    assert.equal(h.sockets[0].closed, 1);
    assert.equal(h.requests.length, 1);
    assert.equal(h.sockets.length, 1);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.errors, []);
    session.close();
  }
});

test("live runtime microphone, audio, processor and send failures never leave capture active", async () => {
  for (const failure of ["microphone", "suspended", "processor", "send", "source"] as const) {
    const h = await fixture();
    const session = await h.ready();
    if (failure === "microphone") h.track.dispatchEvent(new Event("ended"));
    if (failure === "suspended") { h.audios[0].state = "suspended"; h.audios[0].onstatechange?.(); }
    if (failure === "processor") h.worklets[0].onprocessorerror?.();
    if (failure === "send") { h.settings.failSend = true; session.context("context", "delegation-1"); }
    if (failure === "source") {
      h.settings.failSource = true;
      h.sockets[0].emit({ type: "session.output_audio.delta", delta: pcm() });
    }
    assert.equal(h.errors.length, 1);
    assert.equal(h.stats().stopped, 1);
    assert.equal(h.audios[0].closed, 1);
    assert.equal(h.worklets[0].port.closed, 1);
    assert.doesNotMatch(h.errors[0], /private-ticket/);
  }
});

test("live pre-aborted or unsupported sessions acquire no microphone or socket", async () => {
  for (const condition of ["abort", "audio", "microphone"] as const) {
    const h = await fixture();
    if (condition === "abort") h.abort.abort();
    if (condition === "audio") h.settings.unsupported = true;
    if (condition === "microphone") h.settings.noMicrophone = true;
    await assert.rejects(h.create(), condition === "abort" ? { name: "AbortError" } : /supported browser/);
    assert.equal(h.constraints.length, 0);
    assert.equal(h.audios.length, 0);
    assert.equal(h.requests.length, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.stats().ended, 1);
  }
});

test("live initialization failures revoke worklet URLs and release pending microphone grants", async () => {
  const h = await fixture();
  const media = deferred<unknown>();
  h.settings.media = media.promise;
  h.settings.module = Promise.reject(new Error("private-token"));
  await assert.rejects(h.create(), /AudioWorklet/);
  assert.equal(h.audios[0].closed, 1);
  assert.deepEqual(h.revoked, ["blob:worklet-0"]);
  media.resolve(h.stream);
  await flush();
  assert.equal(h.stats().stopped, 1);
  assert.equal(h.worklets.length, 0);
  assert.doesNotMatch(h.errors[0], /private-token/);
});

test("live shutdown while parsing startup response cannot open a late websocket", async () => {
  const h = await fixture();
  const body = deferred<unknown>();
  h.settings.fetch = Promise.resolve({ ok: true, json: () => body.promise });
  const session = await h.create();
  const started = session.start();
  const rejected = assert.rejects(started, { name: "AbortError" });
  await flush();
  session.close();
  await rejected;
  body.resolve(h.settings.response);
  await flush();
  assert.equal(h.sockets.length, 0);
  assert.equal(h.stats().stopped, 1);
});

test("live fetch and socket construction failures stay local, bounded and sanitized", async () => {
  for (const failure of ["status", "fetch", "json", "socket"] as const) {
    const h = await fixture();
    if (failure === "status") h.settings.responseOk = false;
    if (failure === "fetch") h.settings.fetch = Promise.reject(new Error("private-token"));
    if (failure === "json") h.settings.fetch = Promise.resolve({
      ok: true, json: async () => { throw new Error("private-token"); },
    });
    if (failure === "socket") h.settings.failSocket = true;
    // A mocked fetch rejection is observed immediately, like a real fetch call.
    void h.settings.fetch?.catch(() => {});
    const session = await h.create();
    await assert.rejects(session.start());
    assert.equal(h.requests.length, 1);
    assert.equal(h.sockets.length, 0);
    assert.equal(h.stats().stopped, 1);
    assert.equal(h.audios[0].closed, 1);
    assert.equal(h.timers.size, 0);
    assert.equal(h.errors.length, 1);
    assert.doesNotMatch(h.errors[0], /private-token/);
  }
});

test("live naturally completed playback disconnects nodes without stopping the microphone", async () => {
  const h = await fixture();
  const session = await h.ready();
  h.sockets[0].emit({ type: "session.output_audio.delta", delta: pcm() });
  const source = h.audios[0].sources[0];
  const onended = source.onended!;
  onended();
  onended();
  assert.equal(source.disconnected, 1);
  assert.equal(h.stats().stopped, 0);
  session.close();
  assert.equal(source.stopped, 0);
  assert.equal(source.disconnected, 1);
});

test("live callback exceptions cannot interrupt resource disposal", async () => {
  const h = await fixture();
  const session = await h.ready();
  h.events.error = () => { throw new Error("view error"); };
  h.events.ended = () => { throw new Error("view error"); };
  h.events.activity = () => { throw new Error("view error"); };
  h.frame(true);
  h.sockets[0].onerror?.();
  session.close();
  assert.equal(h.stats().stopped, 1);
  assert.equal(h.audios[0].closed, 1);
  assert.equal(h.worklets[0].port.closed, 1);
  assert.equal(h.sockets[0].closed, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.diagnostics.length, 4);
  for (const diagnostic of h.diagnostics) {
    assert.equal(diagnostic.length, 1);
    assert.match(String(diagnostic[0]), /event callback failed/);
    assert.doesNotMatch(String(diagnostic[0]), /view error/);
  }
});

test("live cleanup failures are reported once only after all remaining resources are attempted", async () => {
  for (const failure of ["track", "playback", "disconnect", "socket", "port", "audio", "all"] as const) {
    const h = await fixture();
    const session = await h.ready();
    h.sockets[0].emit({ type: "session.output_audio.delta", delta: pcm() });
    h.settings.failTrackStop = failure === "track" || failure === "all";
    h.settings.failPlaybackStop = failure === "playback" || failure === "all";
    h.settings.failDisconnect = failure === "disconnect" || failure === "all";
    h.settings.failSocketClose = failure === "socket" || failure === "all";
    h.settings.failPortClose = failure === "port" || failure === "all";
    h.settings.failAudioClose = failure === "audio" || failure === "all";
    const attempted: boolean[] = [];
    h.events.error = (message) => {
      h.errors.push(message);
      attempted.push(h.stats().stopped === 1 && h.audios[0].closed === 1
        && h.audios[0].input.disconnected === 1 && h.audios[0].gain.disconnected === 1
        && h.worklets[0].port.closed === 1 && h.worklets[0].disconnected === 1
        && h.sockets[0].closed === 1 && h.audios[0].sources[0].stopped === 1
        && h.audios[0].sources[0].disconnected === 1);
    };
    session.close();
    session.close();
    h.abort.abort();
    assert.deepEqual(h.errors, [], "callbacks cannot interrupt the release loop");
    await flush();
    assert.equal(h.errors.length, 1, failure);
    assert.match(h.errors[0], /could not release every/);
    assert.doesNotMatch(h.errors[0], /private/);
    assert.deepEqual(attempted, [true]);
    assert.equal(h.stats().ended, 1);
    assert.equal(h.timers.size, 0);
  }
});

test("live asynchronous close rejection joins synchronous failures in a single cleanup error", async () => {
  for (const failStop of [false, true]) {
    const h = await fixture();
    const session = await h.ready();
    const closing = deferred<void>();
    h.settings.audioClose = closing.promise;
    h.settings.failTrackStop = failStop;
    session.close();
    await flush();
    assert.deepEqual(h.errors, [], "wait for the asynchronous close before reporting");
    assert.equal(h.worklets[0].port.closed, 1);
    assert.equal(h.sockets[0].closed, 1);
    closing.reject(new Error("private close rejection"));
    await flush();
    assert.equal(h.errors.length, 1);
    assert.match(h.errors[0], /could not release every/);
    assert.doesNotMatch(h.errors[0], /private/);
    session.close();
    h.abort.abort();
    await flush();
    assert.equal(h.errors.length, 1);
  }
});

test("live cleanup error callback failure is diagnostic, non-recursive and does not retry cleanup", async () => {
  const h = await fixture();
  const session = await h.ready();
  h.settings.failDisconnect = true;
  let reported = 0;
  h.events.error = () => {
    reported++;
    session.close();
    h.abort.abort();
    throw new Error("private callback failure");
  };
  session.close();
  await flush();
  assert.equal(reported, 1);
  assert.equal(h.audios[0].closed, 1);
  assert.equal(h.worklets[0].disconnected, 1);
  assert.equal(h.worklets[0].port.closed, 1);
  assert.equal(h.stats().stopped, 1);
  assert.equal(h.diagnostics.length, 1);
  assert.match(String(h.diagnostics[0][0]), /event callback failed/);
  assert.doesNotMatch(JSON.stringify(h.diagnostics), /private/);
});

test("live late microphone cleanup failure after abort is reported without raw error content", async () => {
  const h = await fixture();
  const media = deferred<unknown>();
  h.settings.media = media.promise;
  const creating = h.create();
  const rejected = assert.rejects(creating, { name: "AbortError" });
  h.abort.abort();
  await rejected;
  h.settings.failTrackStop = true;
  media.resolve(h.stream);
  await flush();
  assert.equal(h.stats().stopped, 1);
  assert.equal(h.stats().ended, 1);
  assert.equal(h.audios[0].closed, 1);
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /could not release every/);
  assert.doesNotMatch(h.errors[0], /private/);
});
