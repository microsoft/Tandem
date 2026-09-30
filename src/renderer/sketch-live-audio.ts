/**
 * Integrates the source samples over exact 16 kHz intervals. Keeping the phase
 * between render quanta avoids both dropped samples and 44.1 kHz clock drift.
 * This function is also embedded in the worklet, so it has no module dependencies
 * or class fields requiring transpiler helpers in the ES2020 renderer bundle.
 */
export function createPcm16FrameEncoder(
  sampleRate: number,
  emit: (frame: ArrayBuffer) => void,
): { push(samples: Float32Array): void } {
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 384_000) {
    throw new Error("Unsupported microphone sample rate.");
  }
  let accumulatedWeight = 0;
  let sum = 0;
  let position = 0;
  let frame = new DataView(new ArrayBuffer(640));
  return {
    push(samples) {
      if (samples.length > 4_096) throw new Error("Microphone render quantum is too large.");
      for (const input of samples) {
        const sample = Number.isFinite(input) ? Math.max(-1, Math.min(1, input)) : 0;
        let remaining = 16_000;
        while (remaining > 0) {
          const weight = Math.min(remaining, sampleRate - accumulatedWeight);
          sum += sample * weight;
          accumulatedWeight += weight;
          remaining -= weight;
          if (accumulatedWeight !== sampleRate) continue;
          const value = sum / sampleRate;
          frame.setInt16(position * 2, Math.round(value * (value < 0 ? 32_768 : 32_767)), true);
          sum = 0;
          accumulatedWeight = 0;
          if (++position === 320) {
            const completed = frame.buffer;
            frame = new DataView(new ArrayBuffer(640));
            position = 0;
            emit(completed);
          }
        }
      }
    },
  };
}

export function sketchLiveInputWorklet(): string {
  return `
const createFrameEncoder = (${createPcm16FrameEncoder.toString()});
registerProcessor("tandem-sketch-live-input", class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.running = false;
    this.pending = new Set();
    this.sequence = 0;
    this.hold = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "start") {
        this.pending.clear();
        this.hold = 0;
        this.encoder = createFrameEncoder(sampleRate, (audio) => this.frame(audio));
        this.running = true;
      } else if (data.type === "ack") {
        this.pending.delete(data.sequence);
      } else if (data.type === "stop") {
        this.running = false;
        this.encoder = undefined;
        this.pending.clear();
      }
    };
  }
  frame(audio) {
    if (!this.running) return;
    if (this.pending.size >= 16) {
      this.running = false;
      this.port.postMessage({ type: "overflow" });
      return;
    }
    const pcm = new DataView(audio);
    let energy = 0;
    for (let i = 0; i < 320; i++) {
      const value = pcm.getInt16(i * 2, true) / 32768;
      energy += value * value;
    }
    this.hold = energy / 320 >= 0.000625 ? 10 : Math.max(0, this.hold - 1);
    const sequence = ++this.sequence;
    this.pending.add(sequence);
    this.port.postMessage({ type: "frame", audio, sequence, speaking: this.hold > 0 }, [audio]);
  }
  process(inputs) {
    if (this.running && inputs[0] && inputs[0][0]) this.encoder.push(inputs[0][0]);
    return true;
  }
});
`;
}

export function encodeLivePcmFrame(frame: ArrayBuffer): string {
  if (frame.byteLength !== 640) throw new Error("Invalid microphone frame.");
  let binary = "";
  for (const byte of new Uint8Array(frame)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeLivePcmAudio(encoded: string): Float32Array<ArrayBuffer> {
  // A single delta may contain at most one second of mono PCM16 at 16 kHz.
  if (!encoded.length || encoded.length > 42_668 || encoded.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("Invalid output audio.");
  }
  const binary = atob(encoded);
  if (!binary.length || binary.length > 32_000 || binary.length % 2 !== 0 || btoa(binary) !== encoded) {
    throw new Error("Invalid output audio.");
  }
  const samples = new Float32Array(binary.length / 2);
  for (let index = 0; index < samples.length; index++) {
    const word = binary.charCodeAt(index * 2) | (binary.charCodeAt(index * 2 + 1) << 8);
    samples[index] = (word >= 0x8000 ? word - 0x10000 : word) / 32_768;
  }
  return samples;
}
