import "server-only";
import { languageCode } from "@/lib/avatar/languages";
import type { AvatarRecord, Persona, SpeechProvider, VoiceProfile } from "@/lib/avatar/types";
import { config } from "./config";
import { updateAvatar } from "./db";
import * as eleven from "./elevenlabs";
import {
  cloneVoice as cloneMinimax,
  PRESET_VOICES as MINIMAX_VOICES,
  speak as speakMinimax,
  transcribe,
  uploadToFal,
} from "./fal";
import { brightenWav } from "./brighten";
import * as fish from "./fish";
import { PCM_SAMPLE_RATE } from "./pcm";
import { contentTypeFor, getFile } from "./storage";

/**
 * Which voice an avatar speaks with, and with which service.
 * - Stock voices come from `activeProvider()` (ElevenLabs, or MiniMax on fal).
 * - Cloned voices live with `cloneProvider()` (Fish Audio when configured,
 *   else ElevenLabs or MiniMax). The creator's recording is kept, so a clone
 *   is only a cache: it is re-created from the recording after a provider
 *   switch, or when it goes missing. Fish in "inline" mode stores nothing at
 *   all: the recording and its transcript go with every request.
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

/** What is said in a recording, in the persona's language. */
async function transcribeSample(record: AvatarRecord, sample: Sample): Promise<string> {
  const url = await uploadToFal(sample.data, sample.contentType, sample.filename);
  const text = await transcribe(url, languageCode(record.persona.language));
  if (!text) throw new Error("No speech found in the voice recording");
  return text;
}

/**
 * Makes a clone of `sample` with `provider`. Fish in inline mode needs no
 * clone, only the transcript (reused when the recording is unchanged).
 */
async function makeClone(
  record: AvatarRecord,
  provider: "fish" | "elevenlabs",
  sample: Sample,
  knownText?: string,
): Promise<Pick<VoiceProfile, "voiceId" | "sampleText">> {
  if (provider === "fish" && config.tts.fishVoiceMode === "inline") {
    return { voiceId: "", sampleText: knownText ?? (await transcribeSample(record, sample)) };
  }
  const params = { ...sample, audio: sample.data, description: `Voice for iident avatar ${record.id}` };
  const voiceId =
    provider === "fish"
      ? await fish.createVoiceModel({ ...params, title: cloneName(record) })
      : await eleven.cloneVoice({ ...params, name: cloneName(record) });
  return { voiceId, ...(knownText ? { sampleText: knownText } : {}) };
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
    const made = await makeClone(record, provider, sample);
    voice = { mode: "clone", provider, ...made, sampleFile: sample.file, createdAt: Date.now() };
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
 * per server instance even if several visitors arrive together (two
 * instances can each make one; the later save wins and the other clone is
 * left unused). The old clone is freed.
 */
function recreateClone(record: AvatarRecord, provider: "fish" | "elevenlabs"): Promise<string> {
  let pending = recreations.get(record.id);
  if (!pending) {
    pending = (async () => {
      const made = await makeClone(record, provider, await storedSample(record), record.voice?.sampleText);
      await updateAvatar(record.id, (r) => {
        if (r.voice) r.voice = { ...r.voice, provider, ...made, previewUrl: undefined };
      });
      freeClone(record.voice, made.voiceId);
      return made.voiceId;
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
    await updateAvatar(record.id, (r) => {
      if (r.voice) r.voice = { ...r.voice, voiceId: fresh.voiceId };
    });
    return speakMinimax({ text, voiceId: fresh.voiceId });
  }
}

const references = new Map<string, Promise<fish.FishReference>>();

/**
 * The recording and its transcript, for Fish inline cloning. Kept in memory
 * per recording, so a reply doesn't re-read it for every sentence. A missing
 * transcript (older recordings) is made once and saved.
 */
function fishReference(record: AvatarRecord): Promise<fish.FishReference> {
  const voice = record.voice;
  const key = voice?.sampleFile;
  if (!key) return Promise.reject(new Error("Voice sample is missing"));
  let reference = references.get(key);
  if (!reference) {
    reference = (async () => {
      const sample = await storedSample(record);
      let text = voice.sampleText;
      if (!text) {
        text = await transcribeSample(record, sample);
        const saved = text;
        await updateAvatar(record.id, (r) => {
          if (r.voice?.sampleFile === key) r.voice = { ...r.voice, sampleText: saved };
        });
      }
      // A dull recording gives a dull clone, so its highs are lifted first (the stored file is untouched).
      const { data, boostDb } = brightenWav(sample.data);
      if (boostDb) console.info(`Brightened the voice reference of ${record.id} by ${boostDb.toFixed(1)} dB`);
      return { audio: data, text };
    })();
    references.set(key, reference);
    reference.catch(() => references.delete(key));
    if (references.size > 32) references.delete(references.keys().next().value!);
  }
  return reference;
}

/**
 * Speech in a Fish clone: from the saved model (rebuilt once from the
 * recording if it went missing), or inline from the recording.
 */
function fishVoice(record: AvatarRecord, voiceId: string) {
  let modelId = voiceId;
  let rebuilt = false;
  const voice = async (): Promise<fish.FishVoice> => (modelId ? { modelId } : { reference: await fishReference(record) });
  async function retrying<T>(attempt: (voice: fish.FishVoice) => Promise<T>): Promise<T> {
    try {
      return await attempt(await voice());
    } catch (err) {
      if (!modelId || rebuilt || !fish.isMissingVoice(err) || !record.voice?.sampleFile) throw err;
      rebuilt = true;
      modelId = await recreateClone(record, "fish");
      return attempt(await voice());
    }
  }
  return {
    async *stream(text: string, signal?: AbortSignal) {
      // Missing-model errors are thrown before any audio is sent, so a retry never repeats speech.
      const first = await retrying(async (voice) => {
        const stream = fish.streamSpeech({ text, voice, signal });
        const head = await stream.next();
        return { stream, head };
      });
      if (first.head.done) return;
      yield first.head.value;
      yield* first.stream;
    },
    mp3: (text: string) => retrying((voice) => fish.speechMp3({ text, voice })),
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
  sampleRate: number,
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
            send({ type: "pcm", index: i, data: Buffer.from(pcm).toString("base64"), sampleRate });
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
    return pcmSpeaker(send, signal, PCM_SAMPLE_RATE, (text, previousText) => eleven.streamSpeech({ text, voiceId, previousText, signal }));
  }
  if (provider === "fish") {
    const voice = fishVoice(record, voiceId);
    return pcmSpeaker(send, signal, config.tts.fishSampleRate, (text) => voice.stream(text, signal));
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
