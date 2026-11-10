import "server-only";
import type { AvatarRecord, Persona, SpeechProvider, VoiceProfile } from "@/lib/avatar/types";
import { config } from "./config";
import { updateAvatar } from "./db";
import * as eleven from "./elevenlabs";
import { cloneVoice as cloneMinimax, PRESET_VOICES as MINIMAX_VOICES, speak as speakMinimax, uploadToFal } from "./fal";
import * as fish from "./fish";
import { PCM_SAMPLE_RATE } from "./pcm";
import { contentTypeFor, getFile } from "./storage";

/**
 * Which voice an avatar speaks with, and with which service.
 * - Stock voices come from `activeProvider()` (ElevenLabs, or MiniMax on fal).
 * - Cloned voices live with `cloneProvider()` (Fish Audio when configured,
 *   else ElevenLabs or MiniMax). The creator's recording is kept, so a clone
 *   is only a cache: it is re-created from the recording after a provider
 *   switch, or when it goes missing.
 */

export const MINIMAX_DEFAULT_VOICE = "Friendly_Person";

/** Speaks stock voices. */
export const activeProvider = () => config.tts.provider;

/** Holds and speaks cloned voices. */
export const cloneProvider = () => config.tts.cloneProvider;

const defaultVoice = (provider: SpeechProvider) =>
  provider === "elevenlabs" ? eleven.ELEVENLABS_DEFAULT_VOICE : MINIMAX_DEFAULT_VOICE;

/** Whether the avatar speaks with a clone of the creator's own voice (only while cloning is on). */
export const usesClonedVoice = (record: AvatarRecord) => config.voiceCloning && record.voice?.mode === "clone";

/** Stock voices for the active provider. */
export function presetVoices(): readonly { id: string; label: string }[] {
  return activeProvider() === "elevenlabs" ? eleven.ELEVENLABS_VOICES : MINIMAX_VOICES;
}

export function greetingFor(p: Persona): string {
  const g = p.greeting.trim();
  if (g) return g;
  const name = p.name.trim();
  const first = name.split(/\s+/)[0];
  return name
    ? `Hey, I'm ${name}'s AI avatar. Ask me anything about ${first}, or just say hi!`
    : "Hey there! I'm an AI avatar. Ask me anything, or just say hi!";
}

type Sample = { data: Uint8Array; filename: string; contentType: string };

const cloneName = (r: AvatarRecord) => `iident ${r.persona.name.trim() || r.id}`.slice(0, 100);

async function createClone(record: AvatarRecord, provider: "fish" | "elevenlabs", sample: Sample): Promise<string> {
  const params = { ...sample, audio: sample.data, description: `Voice for iident avatar ${record.id}` };
  return provider === "fish"
    ? fish.createVoiceModel({ ...params, title: cloneName(record) })
    : eleven.cloneVoice({ ...params, name: cloneName(record) });
}

/** Deletes a clone the avatar no longer uses (freeing its ElevenLabs slot). Best effort. */
export function freeClone(voice: VoiceProfile | undefined, keepId?: string) {
  if (voice?.mode !== "clone" || !voice.voiceId || voice.voiceId === keepId) return;
  const deletion =
    voice.provider === "elevenlabs"
      ? eleven.deleteVoice(voice.voiceId)
      : voice.provider === "fish"
        ? fish.deleteVoiceModel(voice.voiceId)
        : null;
  deletion?.catch((err) => console.warn("Could not free old voice", err));
}

/** Clones a new recording with the clone provider and frees the avatar's previous clone. */
export async function cloneRecording(record: AvatarRecord, sample: Sample & { file: string }): Promise<VoiceProfile> {
  const provider = cloneProvider();
  let voice: VoiceProfile;
  if (provider === "minimax") {
    const sampleUrl = await uploadToFal(sample.data, sample.contentType, sample.filename);
    const cloned = await cloneMinimax({ audioUrl: sampleUrl, previewText: greetingFor(record.persona) });
    voice = { mode: "clone", provider, voiceId: cloned.voiceId, sampleFile: sample.file, sampleUrl, previewUrl: cloned.previewUrl, createdAt: Date.now() };
  } else {
    const voiceId = await createClone(record, provider, sample);
    voice = { mode: "clone", provider, voiceId, sampleFile: sample.file, createdAt: Date.now() };
  }
  freeClone(record.voice, voice.voiceId);
  return voice;
}

async function storedSample(record: AvatarRecord): Promise<Sample> {
  const key = record.voice?.sampleFile;
  const file = key ? await getFile(key) : null;
  if (!key || !file) throw new Error("Voice sample is missing");
  return { data: file.data, filename: key.split("/").pop()!, contentType: contentTypeFor(key) };
}

const recreations = new Map<string, Promise<string>>();

/**
 * Re-creates an avatar's clone with `provider` from the stored recording:
 * after switching clone providers, or when the clone went missing. Runs once
 * even if several visitors arrive together; the old clone is freed.
 */
function recreateClone(record: AvatarRecord, provider: "fish" | "elevenlabs"): Promise<string> {
  let pending = recreations.get(record.id);
  if (!pending) {
    pending = (async () => {
      const voiceId = await createClone(record, provider, await storedSample(record));
      updateAvatar(record.id, (r) => {
        if (r.voice) r.voice = { ...r.voice, provider, voiceId, previewUrl: undefined };
      });
      freeClone(record.voice, voiceId);
      return voiceId;
    })().finally(() => recreations.delete(record.id));
    recreations.set(record.id, pending);
  }
  return pending;
}

const canSpeak = (provider: SpeechProvider) =>
  provider === "elevenlabs" ? !!config.elevenLabsKey : provider === "fish" ? !!config.fishKey : !!config.falKey;

/** The voice to speak with, and the service that speaks it. */
export async function resolveVoice(record: AvatarRecord): Promise<{ provider: SpeechProvider; voiceId: string }> {
  const voice = record.voice;
  // With cloning off, a clone recorded earlier is never spoken.
  if (voice?.mode === "clone" && config.voiceCloning) {
    const provider = cloneProvider();
    const current = voice.provider ?? "minimax";
    if (current === provider) return { provider, voiceId: voice.voiceId };
    if (provider !== "minimax" && voice.sampleFile) {
      try {
        return { provider, voiceId: await recreateClone(record, provider) };
      } catch (err) {
        console.error(`Could not move the voice of ${record.id} to ${provider}`, err);
      }
    }
    // Keep using the old clone while its service is still configured.
    if (canSpeak(current)) return { provider: current, voiceId: voice.voiceId };
  }
  const provider = activeProvider();
  if (voice?.mode === "preset" && (voice.provider ?? "minimax") === provider) return { provider, voiceId: voice.voiceId };
  return { provider, voiceId: defaultVoice(provider) };
}

/**
 * MiniMax via fal returns whole clips. Its clones can expire, so a failing
 * MiniMax clone is re-cloned once from the stored sample and the new id saved.
 */
async function speakMinimaxAs(record: AvatarRecord, text: string, voiceId: string) {
  try {
    return await speakMinimax({ text, voiceId });
  } catch (err) {
    const voice = record.voice;
    const isClone = usesClonedVoice(record) && (voice?.provider ?? "minimax") === "minimax" && voice?.voiceId === voiceId;
    if (!isClone || !voice?.sampleUrl) throw err;
    const fresh = await cloneMinimax({ audioUrl: voice.sampleUrl, previewText: text.slice(0, 200) });
    updateAvatar(record.id, (r) => {
      if (r.voice) r.voice = { ...r.voice, voiceId: fresh.voiceId };
    });
    return speakMinimax({ text, voiceId: fresh.voiceId });
  }
}

/** Fish speech that rebuilds the voice model once from the recording if it went missing. */
function fishVoice(record: AvatarRecord, voiceId: string) {
  let id = voiceId;
  let rebuilt = false;
  async function retrying<T>(attempt: (id: string) => Promise<T>): Promise<T> {
    try {
      return await attempt(id);
    } catch (err) {
      if (rebuilt || !fish.isMissingVoice(err) || !record.voice?.sampleFile) throw err;
      rebuilt = true;
      id = await recreateClone(record, "fish");
      return attempt(id);
    }
  }
  return {
    async *stream(text: string, signal?: AbortSignal) {
      // Missing-model errors are thrown before any audio is sent, so a retry never repeats speech.
      const first = await retrying(async (voiceId) => {
        const stream = fish.streamSpeech({ text, voiceId, signal });
        const head = await stream.next();
        return { stream, head };
      });
      if (first.head.done) return;
      yield first.head.value;
      yield* first.stream;
    },
    mp3: (text: string) => retrying((voiceId) => fish.speechMp3({ text, voiceId })),
  };
}

export type SpeechEvent =
  | { type: "chunk"; index: number; text: string }
  | { type: "pcm"; index: number; data: string; sampleRate: number }
  | { type: "pcm_end"; index: number }
  | { type: "audio"; index: number; url: string; durationMs: number }
  | { type: "audio_error"; index: number };

type Speaker = { say(text: string): void; done(): Promise<void> };

/**
 * Streaming providers (ElevenLabs, Fish): sentences are synthesized one after
 * another, keeping their order, and PCM is forwarded as it streams in.
 */
function pcmSpeaker(
  send: (e: SpeechEvent) => void,
  signal: AbortSignal | undefined,
  synthesize: (text: string, previousText?: string) => AsyncIterable<Uint8Array>,
): Speaker {
  let index = 0;
  let chain: Promise<void> = Promise.resolve();
  let spoken = "";
  return {
    say(text) {
      const i = index++;
      send({ type: "chunk", index: i, text });
      const previousText = spoken.slice(-400) || undefined;
      spoken = spoken ? `${spoken} ${text}` : text;
      chain = chain.then(async () => {
        try {
          for await (const pcm of synthesize(text, previousText)) {
            send({ type: "pcm", index: i, data: Buffer.from(pcm).toString("base64"), sampleRate: PCM_SAMPLE_RATE });
          }
        } catch (err) {
          if (!signal?.aborted) console.error("tts failed", err);
        }
        send({ type: "pcm_end", index: i });
      });
    },
    done: () => chain,
  };
}

/**
 * Turns text chunks into speech events for the browser. ElevenLabs and Fish
 * stream PCM (ElevenLabs also gets the previous text, for natural
 * intonation); MiniMax synthesizes chunks in parallel and returns clip URLs.
 */
export async function createSpeaker(record: AvatarRecord, send: (e: SpeechEvent) => void, signal?: AbortSignal): Promise<Speaker> {
  const { provider, voiceId } = await resolveVoice(record);
  if (provider === "elevenlabs") {
    return pcmSpeaker(send, signal, (text, previousText) => eleven.streamSpeech({ text, voiceId, previousText, signal }));
  }
  if (provider === "fish") {
    const voice = fishVoice(record, voiceId);
    return pcmSpeaker(send, signal, (text) => voice.stream(text, signal));
  }
  let index = 0;
  const pending: Promise<void>[] = [];
  return {
    say(text) {
      const i = index++;
      send({ type: "chunk", index: i, text });
      pending.push(
        speakMinimaxAs(record, text, voiceId)
          .then((a) => send({ type: "audio", index: i, url: a.url, durationMs: a.durationMs }))
          .catch((err) => {
            console.error("tts failed", err);
            send({ type: "audio_error", index: i });
          }),
      );
    },
    done: () => Promise.all(pending).then(() => undefined),
  };
}

const mp3DataUrl = (mp3: Buffer) => ({ url: `data:audio/mpeg;base64,${mp3.toString("base64")}` });

/**
 * A short clip in the avatar's voice (or a stock voice) for previews in the
 * creator. ElevenLabs and Fish clips come back as data URLs; MiniMax as a CDN URL.
 */
export async function previewClip(record: AvatarRecord, text: string, preset?: string): Promise<{ url: string }> {
  const { provider, voiceId } = preset ? { provider: activeProvider(), voiceId: preset } : await resolveVoice(record);
  if (provider === "elevenlabs") return mp3DataUrl(await eleven.speechMp3({ text, voiceId }));
  if (provider === "fish") return mp3DataUrl(await fishVoice(record, voiceId).mp3(text));
  return speakMinimaxAs(record, text, voiceId);
}
