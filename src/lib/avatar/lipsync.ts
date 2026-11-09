"use client";

/**
 * Real-time lip sync from audio. Works with any TTS voice because it only
 * looks at the sound being played:
 *  - loudness in the voice band opens the jaw,
 *  - a low spectral centroid (oo, oh, w) rounds the lips,
 *  - a high centroid (ee, i) spreads them,
 *  - hissy energy above 4 kHz (s, sh, f) closes the jaw toward the teeth.
 * Values are smoothed with fast attack / slower release so the mouth reads
 * as syllables instead of jitter.
 */

export type MouthShape = { jaw: number; wide: number; round: number; level: number };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class LipSync {
  readonly analyser: AnalyserNode;
  private freq: Float32Array<ArrayBuffer>;
  private binHz: number;
  private peakDb = -30;
  private shape: MouthShape = { jaw: 0, wide: 0, round: 0, level: 0 };
  private last = 0;

  constructor(ctx: AudioContext) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.35;
    this.analyser.minDecibels = -100;
    this.analyser.maxDecibels = -10;
    this.freq = new Float32Array(this.analyser.frequencyBinCount);
    this.binHz = ctx.sampleRate / this.analyser.fftSize;
  }

  private band(lo: number, hi: number) {
    const a = Math.max(1, Math.floor(lo / this.binHz));
    const b = Math.min(this.freq.length - 1, Math.ceil(hi / this.binHz));
    let power = 0;
    let weighted = 0;
    for (let i = a; i <= b; i++) {
      const p = Math.pow(10, this.freq[i] / 10);
      power += p;
      weighted += p * i * this.binHz;
    }
    return { power, weighted };
  }

  /** Call once per animation frame while audio is playing. */
  sample(now = performance.now()): MouthShape {
    const dt = Math.min(0.1, Math.max(0.001, (now - (this.last || now - 16)) / 1000));
    this.last = now;
    this.analyser.getFloatFrequencyData(this.freq);

    const voice = this.band(120, 3600);
    const hiss = this.band(4200, 9000);
    const total = voice.power + hiss.power + 1e-12;
    const db = 10 * Math.log10(total);

    // Adaptive peak so quiet and loud voices both use the full range.
    this.peakDb = Math.max(db, this.peakDb - 6 * dt);
    // Calibrated offline against ElevenLabs speech at 60 fps: the mouth is
    // wide open on ~1/3 of frames and closes ~4 times a second, close to the
    // syllable rate of natural speech.
    const gate = this.peakDb - 30;
    let open = clamp01((db - gate) / 30);
    open = Math.pow(open, 1.6);

    const centroid = voice.weighted / (voice.power + 1e-12);
    const sibilance = clamp01((hiss.power / total - 0.18) * 3);
    const round = clamp01((1050 - centroid) / 450) * open;
    const wide = clamp01((centroid - 1500) / 700) * open + sibilance * 0.35;
    const jaw = 0.9 * open * (1 - 0.65 * sibilance) * (1 - 0.25 * round);

    const target: MouthShape = { jaw, wide: clamp01(wide), round, level: open };
    const s = this.shape;
    const ease = (cur: number, to: number) => {
      const rate = to > cur ? 28 : 13;
      return cur + (to - cur) * (1 - Math.exp(-rate * dt));
    };
    s.jaw = ease(s.jaw, target.jaw);
    s.wide = ease(s.wide, target.wide);
    s.round = ease(s.round, target.round);
    s.level = ease(s.level, target.level);
    return { ...s };
  }

  /** Relax toward a closed mouth (between clips or when audio stops). */
  rest(dt: number): MouthShape {
    const s = this.shape;
    const k = 1 - Math.exp(-14 * dt);
    s.jaw += (0 - s.jaw) * k;
    s.wide += (0 - s.wide) * k;
    s.round += (0 - s.round) * k;
    s.level += (0 - s.level) * k;
    return { ...s };
  }
}
