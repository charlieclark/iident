import "server-only";
import type { AvatarRecord, Persona, SpeechProvider } from "@/lib/avatar/types";
import { config } from "./config";
import * as eleven from "./elevenlabs";
import { PRESET_VOICES as MINIMAX_VOICES, speak as speakMinimax } from "./fal";
import { PCM_SAMPLE_RATE } from "./pcm";

/**
 * The voice an avatar speaks with: one of a set of ready-made voices that
 * the creator picks. Nobody's own voice is recorded or copied.
 *
 * The voices come from the speech provider in use: ElevenLabs, which streams
 * audio as it is made, or, where no ElevenLabs key is set (development),
 * MiniMax on fal, which returns whole clips.
 */

export const MINIMAX_DEFAULT_VOICE = "Friendly_Person";

/** The service that speaks. */
export const activeProvider = () => config.tts.provider;

const defaultVoice = (provider: SpeechProvider) => (provider === "elevenlabs" ? eleven.ELEVENLABS_DEFAULT_VOICE : MINIMAX_DEFAULT_VOICE);

/** The voices a creator can pick from. */
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

/**
 * The voice to speak with, and the service that speaks it: the one the
 * creator picked, or the provider's default if they picked none or picked it
 * with a provider that is no longer the one in use.
 */
export function resolveVoice(record: AvatarRecord): { provider: SpeechProvider; voiceId: string } {
  const provider = activeProvider();
  const voice = record.voice;
  if (voice && voice.provider === provider && presetVoices().some((v) => v.id === voice.voiceId)) return { provider, voiceId: voice.voiceId };
  return { provider, voiceId: defaultVoice(provider) };
}

export type SpeechEvent =
  | { type: "chunk"; index: number; text: string }
  | { type: "pcm"; index: number; data: string; sampleRate: number }
  | { type: "pcm_end"; index: number }
  | { type: "audio"; index: number; url: string; durationMs: number }
  | { type: "audio_error"; index: number };

type Speaker = { say(text: string): void; done(): Promise<void> };

/**
 * Turns text chunks into speech events for the browser.
 *
 * ElevenLabs: sentences are synthesized one after another, keeping their
 * order, and PCM is forwarded as it streams in. Each request also gets the
 * text spoken just before, for natural intonation across sentences.
 *
 * MiniMax: chunks are synthesized in parallel and come back as clip links.
 */
export function createSpeaker(record: AvatarRecord, send: (e: SpeechEvent) => void, signal?: AbortSignal): Speaker {
  const { provider, voiceId } = resolveVoice(record);
  let index = 0;
  if (provider === "elevenlabs") {
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
            for await (const pcm of eleven.streamSpeech({ text, voiceId, previousText, signal })) {
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
  const pending: Promise<void>[] = [];
  return {
    say(text) {
      const i = index++;
      send({ type: "chunk", index: i, text });
      pending.push(
        speakMinimax({ text, voiceId })
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
 * A short clip in the avatar's voice, or in `preset` to audition it in the
 * creator. ElevenLabs clips come back as data URLs; MiniMax as a link.
 */
export async function previewClip(record: AvatarRecord, text: string, preset?: string): Promise<{ url: string }> {
  const { provider, voiceId } = preset ? { provider: activeProvider(), voiceId: preset } : resolveVoice(record);
  if (provider === "elevenlabs") return { url: `data:audio/mpeg;base64,${(await eleven.speechMp3({ text, voiceId })).toString("base64")}` };
  return speakMinimax({ text, voiceId });
}
