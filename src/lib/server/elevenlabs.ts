import "server-only";
import { config, HttpError } from "./config";

/**
 * ElevenLabs: instant voice cloning plus streaming text to speech.
 *
 * Speech is requested as raw 16-bit PCM so the browser can schedule each
 * chunk the moment it arrives, without waiting for a whole file to decode.
 * Measured from this app's server: first audio after ~260 ms (v4 Turbo and
 * Flash v2.5), versus ~4 s for a full clip from MiniMax via fal's queue.
 */

const API = "https://api.elevenlabs.io";
export const PCM_SAMPLE_RATE = 24000;

/** A small, varied set of ElevenLabs default voices for the stock voice picker. */
export const ELEVENLABS_VOICES = [
  { id: "SAz9YHcvj6GT2YYXdXww", label: "River (relaxed, neutral)" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah (confident)" },
  { id: "cgSgspJ2msm6clMCkdW9", label: "Jessica (playful, warm)" },
  { id: "XrExE9yKIg1WjnnlVkGX", label: "Matilda (upbeat)" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", label: "Alice (British, clear)" },
  { id: "iP95p4xoKVk53GoZ742B", label: "Chris (down-to-earth)" },
  { id: "bIHbv24MWmeRgasZH58o", label: "Will (relaxed optimist)" },
  { id: "nPczCjzI2devNBz1zQrb", label: "Brian (deep, comforting)" },
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "George (British storyteller)" },
] as const;

export const ELEVENLABS_DEFAULT_VOICE = ELEVENLABS_VOICES[0].id;

function apiKey() {
  if (!config.elevenLabsKey) throw new HttpError(503, "ELEVENLABS_API_KEY is not set.");
  return config.elevenLabsKey;
}

async function failure(res: Response, what: string) {
  let detail = "";
  try {
    const body = (await res.json()) as { detail?: unknown };
    const d = body?.detail as { message?: string; status?: string } | string | undefined;
    detail = typeof d === "string" ? d : (d?.message ?? d?.status ?? "");
  } catch {}
  return new Error(`ElevenLabs ${what} failed (${res.status})${detail ? `: ${detail}` : ""}`);
}

/** Creates an Instant Voice Clone and returns its voice id. */
export async function cloneVoice(params: {
  name: string;
  audio: Uint8Array;
  filename: string;
  contentType: string;
  description?: string;
}): Promise<string> {
  const form = new FormData();
  form.set("name", params.name.slice(0, 100));
  form.append("files", new Blob([new Uint8Array(params.audio)], { type: params.contentType }), params.filename);
  // Browser recordings already go through noise suppression; ElevenLabs notes
  // that isolating clean audio again can make a clone worse.
  form.set("remove_background_noise", "false");
  if (params.description) form.set("description", params.description.slice(0, 500));
  const res = await fetch(`${API}/v1/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
  });
  if (!res.ok) throw await failure(res, "voice cloning");
  return ((await res.json()) as { voice_id: string }).voice_id;
}

/** Frees the voice slot used by a clone. Missing voices are ignored. */
export async function deleteVoice(voiceId: string) {
  const res = await fetch(`${API}/v1/voices/${encodeURIComponent(voiceId)}`, {
    method: "DELETE",
    headers: { "xi-api-key": apiKey() },
  });
  if (!res.ok && res.status !== 404) throw await failure(res, "voice deletion");
}

type SpeechRequest = {
  text: string;
  voiceId: string;
  /** Text spoken just before this request, for natural prosody across chunks. */
  previousText?: string;
  signal?: AbortSignal;
};

function requestBody(r: SpeechRequest) {
  return JSON.stringify({
    text: r.text,
    model_id: config.tts.elevenLabsModel,
    ...(r.previousText ? { previous_text: r.previousText } : {}),
  });
}

/**
 * Streams speech as 16-bit little-endian mono PCM at 24 kHz. Every yielded
 * chunk holds whole samples (an even number of bytes).
 */
export async function* streamSpeech(r: SpeechRequest): AsyncGenerator<Uint8Array> {
  const res = await fetch(
    `${API}/v1/text-to-speech/${encodeURIComponent(r.voiceId)}/stream?output_format=pcm_${PCM_SAMPLE_RATE}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey(), "content-type": "application/json" },
      body: requestBody(r),
      signal: r.signal,
    },
  );
  if (!res.ok || !res.body) throw await failure(res, "speech");
  yield* wholeSamples(res.body);
}

/** Re-chunks a byte stream so no 16-bit sample is split across chunks. */
export async function* wholeSamples(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let carry: number | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      let bytes = value;
      if (carry !== null) {
        const merged = new Uint8Array(bytes.length + 1);
        merged[0] = carry;
        merged.set(bytes, 1);
        bytes = merged;
        carry = null;
      }
      if (bytes.length % 2) {
        carry = bytes[bytes.length - 1];
        bytes = bytes.subarray(0, bytes.length - 1);
      }
      if (bytes.length) yield bytes;
    }
  } finally {
    reader.releaseLock();
  }
}

/** A whole clip as MP3, for short previews. */
export async function speechMp3(r: SpeechRequest): Promise<Buffer> {
  const res = await fetch(
    `${API}/v1/text-to-speech/${encodeURIComponent(r.voiceId)}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey(), "content-type": "application/json" },
      body: requestBody(r),
      signal: r.signal,
    },
  );
  if (!res.ok) throw await failure(res, "speech");
  return Buffer.from(await res.arrayBuffer());
}
