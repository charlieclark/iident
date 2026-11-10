import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AvatarRecord } from "@/lib/avatar/types";

describe("voice selection", () => {
  let config: typeof import("../config").config;
  let voice: typeof import("../voice");
  let eleven: typeof import("../elevenlabs");

  beforeAll(async () => {
    process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "iident-voice-"));
    process.env.TTS_PROVIDER = "elevenlabs";
    ({ config } = await import("../config"));
    voice = await import("../voice");
    eleven = await import("../elevenlabs");
  });

  afterEach(() => {
    config.voiceCloning = false;
  });

  const avatar = (v: AvatarRecord["voice"]) => ({ id: "a1", persona: { name: "Sam" }, voice: v }) as AvatarRecord;
  const clone = avatar({ mode: "clone", provider: "elevenlabs", voiceId: "clone-123", sampleFile: "a1/voice.wav", createdAt: 1 });
  const stock = avatar({ mode: "preset", provider: "elevenlabs", voiceId: "EXAVITQu4vr4xnSDxMaL", createdAt: 1 });

  it("is off by default", () => {
    expect(config.voiceCloning).toBe(false);
  });

  it("never speaks a recorded clone while cloning is off", async () => {
    expect(await voice.resolveVoice(clone)).toEqual({ provider: "elevenlabs", voiceId: eleven.ELEVENLABS_DEFAULT_VOICE });
    expect(voice.usesClonedVoice(clone)).toBe(false);
  });

  it("keeps the stock voice the creator picked", async () => {
    expect(await voice.resolveVoice(stock)).toEqual({ provider: "elevenlabs", voiceId: "EXAVITQu4vr4xnSDxMaL" });
    expect(voice.usesClonedVoice(stock)).toBe(false);
  });

  it("uses the clone again once cloning is turned on", async () => {
    config.voiceCloning = true;
    expect(await voice.resolveVoice(clone)).toEqual({ provider: "elevenlabs", voiceId: "clone-123" });
    expect(voice.usesClonedVoice(clone)).toBe(true);
  });

  it("falls back to the default voice when none was picked", async () => {
    expect(await voice.resolveVoice(avatar(undefined))).toEqual({ provider: "elevenlabs", voiceId: eleven.ELEVENLABS_DEFAULT_VOICE });
  });
});
