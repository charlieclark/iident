import "server-only";
import type { AvatarRecord, Persona, SpeechProvider } from "@/lib/avatar/types";
import { config } from "./config";
import { updateAvatar } from "./db";
import * as eleven from "./elevenlabs";
import { cloneVoice as cloneMinimax, PRESET_VOICES as MINIMAX_VOICES, speak as speakMinimax } from "./fal";
import { contentTypeFor, getFile } from "./storage";

export const MINIMAX_DEFAULT_VOICE = "Friendly_Person";

export const activeProvider = (): SpeechProvider => config.tts.provider;

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

const cloneName = (r: AvatarRecord) => `iident ${r.persona.name.trim() || r.id}`.slice(0, 100);

/** Clones a voice sample with ElevenLabs, freeing the avatar's previous ElevenLabs clone. */
export async function cloneWithElevenLabs(
  record: AvatarRecord,
  sample: { data: Uint8Array; filename: string; contentType: string },
) {
  const voiceId = await eleven.cloneVoice({
    name: cloneName(record),
    audio: sample.data,
    filename: sample.filename,
    contentType: sample.contentType,
    description: `Voice for iident avatar ${record.id}`,
  });
  const old = record.voice;
  if (old?.provider === "elevenlabs" && old.mode === "clone" && old.voiceId !== voiceId) {
    eleven.deleteVoice(old.voiceId).catch((err) => console.warn("Could not free old voice", err));
  }
  return voiceId;
}

const migrations = new Map<string, Promise<string>>();

/**
 * Voices cloned before ElevenLabs was configured belong to MiniMax. The
 * original recording is kept, so they are re-cloned with ElevenLabs on first
 * use (once, even if several visitors arrive at the same time).
 */
function migrateClone(record: AvatarRecord): Promise<string> {
  let pending = migrations.get(record.id);
  if (!pending) {
    pending = (async () => {
      const key = record.voice?.sampleFile;
      const file = key ? await getFile(key) : null;
      if (!key || !file) throw new Error("Voice sample is missing");
      const voiceId = await cloneWithElevenLabs(record, {
        data: file.data,
        filename: key.split("/").pop()!,
        contentType: contentTypeFor(key),
      });
      updateAvatar(record.id, (r) => {
        if (r.voice) r.voice = { ...r.voice, provider: "elevenlabs", voiceId, previewUrl: undefined };
      });
      return voiceId;
    })().finally(() => migrations.delete(record.id));
    migrations.set(record.id, pending);
  }
  return pending;
}

/** The voice id to speak with, for the active provider. */
export async function resolveVoice(record: AvatarRecord): Promise<{ provider: SpeechProvider; voiceId: string }> {
  const provider = activeProvider();
  const voice = record.voice;
  // With cloning off, a clone recorded earlier is never spoken.
  if (voice?.mode === "clone" && !config.voiceCloning) return { provider, voiceId: defaultVoice(provider) };
  const voiceProvider = voice?.provider ?? "minimax";
  if (voice && voiceProvider === provider) return { provider, voiceId: voice.voiceId };
  if (provider === "minimax") return { provider, voiceId: defaultVoice(provider) };
  if (voice?.mode === "clone" && voice.sampleFile) {
    try {
      return { provider, voiceId: await migrateClone(record) };
    } catch (err) {
      console.error(`Could not move voice for ${record.id} to ElevenLabs`, err);
    }
  }
  return { provider, voiceId: defaultVoice(provider) };
}

/**
 * MiniMax via fal returns whole clips. Cloned voices can expire on the
 * provider side, so on failure the voice is re-cloned once from the stored
 * sample and the new id saved.
 */
export async function speakAs(record: AvatarRecord, text: string) {
  const voice = record.voice;
  const own = voice && voice.provider !== "elevenlabs" && (voice.mode === "preset" || config.voiceCloning) ? voice.voiceId : null;
  const voiceId = own ?? MINIMAX_DEFAULT_VOICE;
  try {
    return await speakMinimax({ text, voiceId });
  } catch (err) {
    if (!usesClonedVoice(record) || !record.voice?.sampleUrl) throw err;
    const fresh = await cloneMinimax({ audioUrl: record.voice.sampleUrl, previewText: text.slice(0, 200) });
    updateAvatar(record.id, (r) => {
      if (r.voice) r.voice = { ...r.voice, voiceId: fresh.voiceId };
    });
    return speakMinimax({ text, voiceId: fresh.voiceId });
  }
}

export type SpeechEvent =
  | { type: "chunk"; index: number; text: string }
  | { type: "pcm"; index: number; data: string; sampleRate: number }
  | { type: "pcm_end"; index: number }
  | { type: "audio"; index: number; url: string; durationMs: number }
  | { type: "audio_error"; index: number };

/**
 * Turns text chunks into speech events for the browser.
 * - ElevenLabs: chunks are synthesized one after another (keeping order and
 *   passing the previous text for natural intonation) and PCM is forwarded
 *   as it streams in.
 * - MiniMax: chunks are synthesized in parallel and arrive as clip URLs.
 */
export async function createSpeaker(record: AvatarRecord, send: (e: SpeechEvent) => void, signal?: AbortSignal) {
  const { provider, voiceId } = await resolveVoice(record);
  let index = 0;

  if (provider === "elevenlabs") {
    let chain: Promise<void> = Promise.resolve();
    let spoken = "";
    return {
      say(text: string) {
        const i = index++;
        send({ type: "chunk", index: i, text });
        const previousText = spoken.slice(-400) || undefined;
        spoken = spoken ? `${spoken} ${text}` : text;
        chain = chain.then(async () => {
          try {
            for await (const pcm of eleven.streamSpeech({ text, voiceId, previousText, signal })) {
              send({ type: "pcm", index: i, data: Buffer.from(pcm).toString("base64"), sampleRate: eleven.PCM_SAMPLE_RATE });
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

  const pending: Promise<void>[] = [];
  return {
    say(text: string) {
      const i = index++;
      send({ type: "chunk", index: i, text });
      pending.push(
        speakAs(record, text)
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

/**
 * A short clip in the avatar's voice (or a stock voice) for previews in the
 * creator. ElevenLabs clips come back as a data URL; MiniMax as a CDN URL.
 */
export async function previewClip(record: AvatarRecord, text: string, preset?: string): Promise<{ url: string }> {
  if (activeProvider() === "elevenlabs") {
    const voiceId = preset ?? (await resolveVoice(record)).voiceId;
    const mp3 = await eleven.speechMp3({ text, voiceId });
    return { url: `data:audio/mpeg;base64,${mp3.toString("base64")}` };
  }
  if (preset) return speakMinimax({ text, voiceId: preset });
  return speakAs(record, text);
}
