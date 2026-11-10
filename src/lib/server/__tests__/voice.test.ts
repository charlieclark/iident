import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvatarRecord } from "@/lib/avatar/types";

describe("voice selection", () => {
  let config: typeof import("../config").config;
  let voice: typeof import("../voice");
  let eleven: typeof import("../elevenlabs");
  let db: typeof import("../db");
  let storage: typeof import("../storage");

  beforeAll(async () => {
    process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "iident-voice-"));
    process.env.TTS_PROVIDER = "elevenlabs";
    ({ config } = await import("../config"));
    voice = await import("../voice");
    eleven = await import("../elevenlabs");
    db = await import("../db");
    storage = await import("../storage");
  });

  beforeEach(() => {
    config.voiceCloning = true;
    config.tts.cloneProvider = "elevenlabs";
    config.elevenLabsKey = "el-key";
    config.fishKey = "fish-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const avatar = (v: AvatarRecord["voice"]) => ({ id: "a1", persona: { name: "Sam" }, voice: v }) as AvatarRecord;
  const clone = avatar({ mode: "clone", provider: "elevenlabs", voiceId: "clone-123", sampleFile: "a1/voice.wav", createdAt: 1 });
  const stock = avatar({ mode: "preset", provider: "elevenlabs", voiceId: "EXAVITQu4vr4xnSDxMaL", createdAt: 1 });

  it("is on by default", async () => {
    vi.resetModules();
    const fresh = await import("../config");
    expect(fresh.config.voiceCloning).toBe(true);
  });

  it("never speaks a recorded clone while cloning is off", async () => {
    config.voiceCloning = false;
    expect(await voice.resolveVoice(clone)).toEqual({ provider: "elevenlabs", voiceId: eleven.ELEVENLABS_DEFAULT_VOICE });
    expect(voice.usesClonedVoice(clone)).toBe(false);
  });

  it("keeps the stock voice the creator picked", async () => {
    expect(await voice.resolveVoice(stock)).toEqual({ provider: "elevenlabs", voiceId: "EXAVITQu4vr4xnSDxMaL" });
    expect(voice.usesClonedVoice(stock)).toBe(false);
  });

  it("uses the clone while cloning is on", async () => {
    expect(await voice.resolveVoice(clone)).toEqual({ provider: "elevenlabs", voiceId: "clone-123" });
    expect(voice.usesClonedVoice(clone)).toBe(true);
  });

  it("falls back to the default voice when none was picked", async () => {
    expect(await voice.resolveVoice(avatar(undefined))).toEqual({ provider: "elevenlabs", voiceId: eleven.ELEVENLABS_DEFAULT_VOICE });
  });

  /** An avatar in the database with a stored recording and an ElevenLabs clone. */
  async function avatarWithRecording(provider: "elevenlabs" | "fish", voiceId: string) {
    const { record } = db.createAvatar();
    const sampleFile = await storage.putFile(record.id, "voice-test.wav", new Uint8Array([82, 73, 70, 70]));
    return db.updateAvatar(record.id, (r) => {
      r.persona.name = "Sam";
      r.voice = { mode: "clone", provider, voiceId, sampleFile, createdAt: 1 };
    });
  }

  function mockServices(handlers: Record<string, (init: RequestInit) => Response>) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init: RequestInit = {}) => {
        const key = `${init.method ?? "GET"} ${String(url)}`;
        calls.push(key);
        const handler = Object.entries(handlers).find(([pattern]) => key.startsWith(pattern))?.[1];
        if (!handler) throw new Error(`Unexpected request: ${key}`);
        return handler(init);
      }),
    );
    return calls;
  }

  it("moves an ElevenLabs clone to Fish from the recording and frees the old slot", async () => {
    config.tts.cloneProvider = "fish";
    const record = await avatarWithRecording("elevenlabs", "el-clone");
    const calls = mockServices({
      "POST https://api.fish.audio/model": () => Response.json({ _id: "fish-model", state: "trained" }, { status: 201 }),
      "DELETE https://api.elevenlabs.io/v1/voices/el-clone": () => new Response(null, { status: 200 }),
    });
    expect(await voice.resolveVoice(record)).toEqual({ provider: "fish", voiceId: "fish-model" });
    await vi.waitFor(() => expect(calls).toContain("DELETE https://api.elevenlabs.io/v1/voices/el-clone"));
    expect(db.getAvatar(record.id)?.voice).toMatchObject({ mode: "clone", provider: "fish", voiceId: "fish-model" });
  });

  it("rebuilds a Fish model that went missing, then keeps talking", async () => {
    config.tts.cloneProvider = "fish";
    const record = await avatarWithRecording("fish", "gone-model");
    let speech = 0;
    const calls = mockServices({
      "POST https://api.fish.audio/v1/tts": () =>
        speech++ === 0
          ? Response.json({ status: 404, message: "Model not found" }, { status: 404 })
          : new Response(new Uint8Array([1, 0, 2, 0])),
      "POST https://api.fish.audio/model": () => Response.json({ _id: "new-model", state: "trained" }, { status: 201 }),
      "DELETE https://api.fish.audio/model/gone-model": () => new Response(null, { status: 404 }),
    });
    const events: { type: string }[] = [];
    const speaker = await voice.createSpeaker(record, (e) => events.push(e));
    speaker.say("Hello there.");
    speaker.say("Nice to meet you.");
    await speaker.done();
    expect(events.map((e) => e.type)).toEqual(["chunk", "chunk", "pcm", "pcm_end", "pcm", "pcm_end"]);
    expect(calls.filter((c) => c === "POST https://api.fish.audio/model")).toHaveLength(1);
    expect(db.getAvatar(record.id)?.voice?.voiceId).toBe("new-model");
  });
});
