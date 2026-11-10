import { describe, expect, it } from "vitest";
import { boostNeeded, brightenWav } from "../brighten";

const RATE = 24000;

/** A crude voice-like signal: a low fundamental plus highs at `highGain`. */
function signal(highGain: number, seconds = 2) {
  const x = new Float64Array(RATE * seconds);
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    x[i] = 0.4 * Math.sin(2 * Math.PI * 180 * t) + 0.2 * Math.sin(2 * Math.PI * 900 * t) + highGain * Math.sin(2 * Math.PI * 6000 * t);
  }
  return x;
}

function wav(x: Float64Array) {
  const out = new Uint8Array(44 + x.length * 2);
  const v = new DataView(out.buffer);
  const write = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  write(0, "RIFF");
  v.setUint32(4, 36 + x.length * 2, true);
  write(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  write(36, "data");
  v.setUint32(40, x.length * 2, true);
  x.forEach((s, i) => v.setInt16(44 + i * 2, Math.round(s * 32767), true));
  return out;
}

describe("voice reference brightening", () => {
  it("leaves a bright recording alone", () => {
    const bright = wav(signal(0.06));
    expect(boostNeeded(signal(0.06), RATE)).toBe(0);
    expect(brightenWav(bright).data).toBe(bright);
  });

  it("lifts the highs of a dull recording, up to a cap", () => {
    const dull = signal(0.02);
    const need = boostNeeded(dull, RATE);
    expect(need).toBeGreaterThan(3);
    expect(need).toBeLessThanOrEqual(8);
    const { data, boostDb } = brightenWav(wav(dull));
    expect(boostDb).toBeCloseTo(need, 2);
    // After the boost the recording needs much less.
    const view = new DataView(data.buffer, 44);
    const fixed = Float64Array.from({ length: (data.length - 44) / 2 }, (_, i) => view.getInt16(i * 2, true) / 32768);
    expect(boostNeeded(fixed, RATE)).toBeLessThan(need / 2);
  });

  it("passes through anything that is not 16-bit PCM WAV", () => {
    const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, ...new Array(100).fill(0)]);
    expect(brightenWav(mp3)).toEqual({ data: mp3, boostDb: 0 });
  });
});
