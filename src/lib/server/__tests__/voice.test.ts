import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDatabase } from "../../../../test/database";
import type { AvatarRecord } from "@/lib/avatar/types";
import type { SpeechEvent } from "../voice";

// The two speech services: ElevenLabs streams sound as it is made, MiniMax (on fal) returns a clip.
const streamSpeech = vi.fn<(r: { text: string; voiceId: string; previousText?: string }) => AsyncGenerator<Uint8Array>>();
const speechMp3 = vi.fn(async () => Buffer.from("mp3"));
vi.mock("../elevenlabs", async (original) => ({
  ...(await original<typeof import("../elevenlabs")>()),
  streamSpeech: (r: { text: string; voiceId: string; previousText?: string }) => streamSpeech(r),
  speechMp3: () => speechMp3(),
}));
const speakMinimax = vi.fn<(p: { text: string; voiceId: string }) => Promise<{ url: string; durationMs: number }>>();
vi.mock("../fal", async (original) => ({
  ...(await original<typeof import("../fal")>()),
  speak: (p: { text: string; voiceId: string }) => speakMinimax(p),
}));

describe("the avatar's voice", () => {
  let config: typeof import("../config").config;
  let voice: typeof import("../voice");
  let eleven: typeof import("../elevenlabs");
  let db: typeof import("../db");

  beforeAll(async () => {
    await freshDatabase("voice");
    ({ config } = await import("../config"));
    voice = await import("../voice");
    eleven = await import("../elevenlabs");
    db = await import("../db");
  });
  beforeEach(() => {
    config.tts.provider = "elevenlabs";
    streamSpeech.mockReset();
    speakMinimax.mockReset();
    speechMp3.mockClear();
  });

  const avatar = (v?: AvatarRecord["voice"]) => ({ id: "a1", voice: v }) as AvatarRecord;
  const picked = () => eleven.ELEVENLABS_VOICES[3].id;

  it("offers the voices of the speech service in use", () => {
    expect(voice.presetVoices()).toBe(eleven.ELEVENLABS_VOICES);
    config.tts.provider = "minimax";
    expect(voice.presetVoices().some((v) => v.id === voice.MINIMAX_DEFAULT_VOICE)).toBe(true);
  });

  it("speaks with the voice the creator picked", () => {
    expect(voice.resolveVoice(avatar({ provider: "elevenlabs", voiceId: picked(), createdAt: 1 }))).toEqual({ provider: "elevenlabs", voiceId: picked() });
  });

  it("falls back to the default voice when none fits", () => {
    const fallback = { provider: "elevenlabs", voiceId: eleven.ELEVENLABS_DEFAULT_VOICE };
    // None picked yet.
    expect(voice.resolveVoice(avatar())).toEqual(fallback);
    // Picked with the other speech service, whose voice ids mean nothing here.
    expect(voice.resolveVoice(avatar({ provider: "minimax", voiceId: "Calm_Woman", createdAt: 1 }))).toEqual(fallback);
    expect(voice.resolveVoice(avatar({ voiceId: "Calm_Woman", createdAt: 1 }))).toEqual(fallback);
    // An id that is not one of the voices on offer is never spoken.
    expect(voice.resolveVoice(avatar({ provider: "elevenlabs", voiceId: "someones-own-voice", createdAt: 1 }))).toEqual(fallback);
    config.tts.provider = "minimax";
    expect(voice.resolveVoice(avatar({ provider: "elevenlabs", voiceId: picked(), createdAt: 1 }))).toEqual({ provider: "minimax", voiceId: voice.MINIMAX_DEFAULT_VOICE });
  });

  it("drops a voice cloned before cloning was removed", async () => {
    const { record } = await db.createAvatar();
    // As such a record was stored: a clone of the creator's recording.
    await db.updateAvatar(record.id, (r) => {
      r.voice = { mode: "clone", provider: "fish", voiceId: "", sampleFile: `${record.id}/voice-1.wav`, sampleText: "Hello", createdAt: 1 } as unknown as AvatarRecord["voice"];
    });
    const loaded = (await db.getAvatar(record.id))!;
    expect(loaded.voice).toBeUndefined();
    expect(voice.resolveVoice(loaded)).toEqual({ provider: "elevenlabs", voiceId: eleven.ELEVENLABS_DEFAULT_VOICE });
    // A picked voice from the same time is kept, without the fields that are gone.
    await db.updateAvatar(record.id, (r) => {
      r.voice = { mode: "preset", provider: "elevenlabs", voiceId: picked(), createdAt: 2 } as unknown as AvatarRecord["voice"];
    });
    expect((await db.getAvatar(record.id))!.voice).toEqual({ provider: "elevenlabs", voiceId: picked(), createdAt: 2 });
  });

  it("streams ElevenLabs speech sentence by sentence, in order, each told what came before", async () => {
    streamSpeech.mockImplementation(async function* (r) {
      // The first sentence takes longer to make than the second.
      if (r.text.startsWith("Hi")) await new Promise((done) => setTimeout(done, 20));
      yield new Uint8Array([1, 2]);
      yield new Uint8Array([3, 4]);
    });
    const events: SpeechEvent[] = [];
    const speaker = voice.createSpeaker(avatar({ provider: "elevenlabs", voiceId: picked(), createdAt: 1 }), (e) => events.push(e));
    speaker.say("Hi there.");
    speaker.say("How are you?");
    await speaker.done();
    expect(events.map((e) => `${e.type}${e.index}`)).toEqual(["chunk0", "chunk1", "pcm0", "pcm0", "pcm_end0", "pcm1", "pcm1", "pcm_end1"]);
    expect(streamSpeech.mock.calls.map((c) => [c[0].voiceId, c[0].text, c[0].previousText])).toEqual([
      [picked(), "Hi there.", undefined],
      [picked(), "How are you?", "Hi there."],
    ]);
    expect(events.find((e) => e.type === "pcm")).toMatchObject({ data: Buffer.from([1, 2]).toString("base64") });
  });

  it("carries on when a sentence can't be spoken", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    streamSpeech.mockImplementation(async function* () {
      throw new Error("speech service down");
    });
    const events: SpeechEvent[] = [];
    const speaker = voice.createSpeaker(avatar(), (e) => events.push(e));
    speaker.say("Hi there.");
    await speaker.done();
    // The text still reaches the visitor, and the sentence is closed.
    expect(events.map((e) => e.type)).toEqual(["chunk", "pcm_end"]);

    config.tts.provider = "minimax";
    speakMinimax.mockRejectedValueOnce(new Error("down")).mockResolvedValue({ url: "https://fal.example/clip.mp3", durationMs: 900 });
    const clips: SpeechEvent[] = [];
    const fallback = voice.createSpeaker(avatar(), (e) => clips.push(e));
    fallback.say("One.");
    fallback.say("Two.");
    await fallback.done();
    // Clips are made side by side and arrive as each is ready; the index says where each belongs.
    expect(clips.filter((e) => e.type !== "chunk").sort((x, y) => x.index - y.index)).toEqual([
      { type: "audio_error", index: 0 },
      { type: "audio", index: 1, url: "https://fal.example/clip.mp3", durationMs: 900 },
    ]);
    expect(speakMinimax).toHaveBeenCalledWith({ text: "Two.", voiceId: voice.MINIMAX_DEFAULT_VOICE });
    error.mockRestore();
  });

  it("plays a sample of any voice on offer", async () => {
    expect(await voice.previewClip(avatar(), "Hello!", picked())).toEqual({ url: `data:audio/mpeg;base64,${Buffer.from("mp3").toString("base64")}` });
    config.tts.provider = "minimax";
    speakMinimax.mockResolvedValue({ url: "https://fal.example/clip.mp3", durationMs: 900 });
    expect(await voice.previewClip(avatar(), "Hello!", "Calm_Woman")).toMatchObject({ url: "https://fal.example/clip.mp3" });
    expect(speakMinimax).toHaveBeenCalledWith({ text: "Hello!", voiceId: "Calm_Woman" });
  });
});
