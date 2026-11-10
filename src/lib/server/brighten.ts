import "server-only";

/**
 * A cloned voice inherits the tone of its reference recording: a muffled
 * recording (laptop mic, call-style noise suppression) gives a muffled
 * clone. Measured with Fish Audio, boosting the highs of a dull reference
 * brings the clone back to within 1 dB of a clean one.
 *
 * `brightenWav` measures how much of a recording's energy sits above 4 kHz
 * and, when that is well below a clean voice, applies a high-shelf boost.
 * Clean recordings and anything that isn't 16-bit PCM WAV pass through
 * unchanged.
 */

/**
 * Share of a recording's energy above 4 kHz below which it counts as dull,
 * in dB. Close-mic recordings of real readers measured -13 to -16, a clean
 * synthetic voice -22, and the same voice deliberately dulled -28.
 */
const TARGET_HIGH_DB = -22;
const MAX_BOOST_DB = 8;
const MIN_BOOST_DB = 1.5;
const SHELF_HZ = 3500;

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

function filter(x: Float64Array, c: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

// Biquad designs from the RBJ Audio EQ Cookbook.
function highPass(rate: number, hz: number): Biquad {
  const w = (2 * Math.PI * hz) / rate;
  const alpha = Math.sin(w) / Math.SQRT2;
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

function highShelf(rate: number, hz: number, gainDb: number): Biquad {
  const A = 10 ** (gainDb / 40);
  const w = (2 * Math.PI * hz) / rate;
  const cos = Math.cos(w);
  const beta = Math.sin(w) * Math.sqrt(2 * A); // shelf slope 1
  const a0 = A + 1 - (A - 1) * cos + beta;
  return {
    b0: (A * (A + 1 + (A - 1) * cos + beta)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cos)) / a0,
    b2: (A * (A + 1 + (A - 1) * cos - beta)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cos)) / a0,
    a2: (A + 1 - (A - 1) * cos - beta) / a0,
  };
}

const energy = (x: Float64Array) => x.reduce((sum, v) => sum + v * v, 0);

type Wav = { rate: number; channels: number; dataStart: number; dataLength: number };

function parseWav(bytes: Uint8Array): Wav | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let fmt: { rate: number; channels: number } | null = null;
  for (let o = 12; o + 8 <= bytes.length; ) {
    const size = view.getUint32(o + 4, true);
    if (tag(o) === "fmt ") {
      if (view.getUint16(o + 8, true) !== 1 || view.getUint16(o + 22, true) !== 16) return null; // 16-bit PCM only
      fmt = { channels: view.getUint16(o + 10, true), rate: view.getUint32(o + 12, true) };
    } else if (tag(o) === "data") {
      if (!fmt || !fmt.channels) return null;
      return { ...fmt, dataStart: o + 8, dataLength: Math.min(size, bytes.length - o - 8) };
    }
    o += 8 + size + (size % 2);
  }
  return null;
}

/** How many dB of high-shelf boost a recording needs (0 when it is bright enough or too short to judge). */
export function boostNeeded(samples: Float64Array, rate: number): number {
  if (rate < 16000 || samples.length < rate) return 0;
  const voiced = filter(samples, highPass(rate, 80));
  const total = energy(voiced);
  if (!total) return 0;
  // Three passes make the cutoff steep enough that the much louder mids don't leak in.
  const hp = highPass(rate, 4000);
  const highs = filter(filter(filter(voiced, hp), hp), hp);
  const highDb = 10 * Math.log10(energy(highs) / total + 1e-12);
  const boost = Math.min(MAX_BOOST_DB, TARGET_HIGH_DB - highDb);
  return boost >= MIN_BOOST_DB ? boost : 0;
}

/** Returns the recording with its highs lifted when it is dull, as mono 16-bit WAV; otherwise the input. */
export function brightenWav(bytes: Uint8Array): { data: Uint8Array; boostDb: number } {
  const wav = parseWav(bytes);
  if (!wav) return { data: bytes, boostDb: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset + wav.dataStart, wav.dataLength);
  const frames = Math.floor(wav.dataLength / 2 / wav.channels);
  const mono = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < wav.channels; c++) sum += view.getInt16((i * wav.channels + c) * 2, true);
    mono[i] = sum / wav.channels / 32768;
  }
  const boostDb = boostNeeded(mono, wav.rate);
  if (!boostDb) return { data: bytes, boostDb: 0 };

  const bright = filter(mono, highShelf(wav.rate, SHELF_HZ, boostDb));
  let peak = 0;
  for (const v of bright) peak = Math.max(peak, Math.abs(v));
  const scale = peak > 0.98 ? 0.98 / peak : 1;

  const out = new Uint8Array(44 + frames * 2);
  const o = new DataView(out.buffer);
  const write = (at: number, s: string) => [...s].forEach((ch, i) => o.setUint8(at + i, ch.charCodeAt(0)));
  write(0, "RIFF");
  o.setUint32(4, 36 + frames * 2, true);
  write(8, "WAVEfmt ");
  o.setUint32(16, 16, true);
  o.setUint16(20, 1, true);
  o.setUint16(22, 1, true);
  o.setUint32(24, wav.rate, true);
  o.setUint32(28, wav.rate * 2, true);
  o.setUint16(32, 2, true);
  o.setUint16(34, 16, true);
  write(36, "data");
  o.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) o.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, bright[i] * scale)) * 32767), true);
  return { data: out, boostDb };
}
