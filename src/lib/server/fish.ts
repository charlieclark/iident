import "server-only";
import { config, HttpError } from "./config";
import { PCM_SAMPLE_RATE, wholeSamples } from "./pcm";

/**
 * Fish Audio: voice cloning without voice slots, plus streaming text to speech.
 *
 * A creator's recording is uploaded once as a private "fast" voice model,
 * which is usable right away, and speech refers to it by id. Fish publishes
 * no cap on models or monthly clone quota. The model is only a cache of the
 * recording iident keeps, so one that goes missing is rebuilt from it.
 */

const API = "https://api.fish.audio";

function apiKey() {
  if (!config.fishKey) throw new HttpError(503, "FISH_API_KEY is not set.");
  return config.fishKey;
}

export class FishError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function failure(res: Response, what: string) {
  let detail = "";
  try {
    const body = (await res.json()) as { message?: unknown; reason?: unknown; detail?: unknown };
    detail = [body.message, body.reason, body.detail].filter((x) => typeof x === "string" && x).join(": ");
  } catch {}
  return new FishError(res.status, `Fish Audio ${what} failed (${res.status})${detail ? `: ${detail}` : ""}`);
}

/** A voice request failed because the model is gone or unusable, so it should be rebuilt from the recording. */
export const isMissingVoice = (err: unknown) =>
  err instanceof FishError &&
  (err.status === 404 || ((err.status === 400 || err.status === 422) && /model|reference/i.test(err.message)));

/** Creates a private voice model from a recording and returns its id. */
export async function createVoiceModel(params: {
  title: string;
  audio: Uint8Array;
  filename: string;
  contentType: string;
  description?: string;
}): Promise<string> {
  const form = new FormData();
  form.set("type", "tts");
  form.set("train_mode", "fast");
  form.set("visibility", "private");
  form.set("title", params.title.slice(0, 100));
  if (params.description) form.set("description", params.description.slice(0, 500));
  form.append("voices", new Blob([new Uint8Array(params.audio)], { type: params.contentType }), params.filename);
  // Without a transcript Fish runs speech recognition on the recording itself.
  const res = await fetch(`${API}/model`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!res.ok) throw await failure(res, "voice cloning");
  const model = (await res.json()) as { _id?: string; state?: string };
  if (!model._id || model.state === "failed") throw new FishError(422, "Fish Audio could not build a voice from that recording");
  return model._id;
}

/** Deletes a voice model. Missing models are ignored. */
export async function deleteVoiceModel(id: string) {
  const res = await fetch(`${API}/model/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok && res.status !== 404) throw await failure(res, "voice deletion");
}

type SpeechRequest = { text: string; voiceId: string; signal?: AbortSignal };

function speechRequest(r: SpeechRequest, format: "pcm" | "mp3"): RequestInit {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey()}`,
      "content-type": "application/json",
      model: config.tts.fishModel,
    },
    body: JSON.stringify({
      text: r.text,
      reference_id: r.voiceId,
      format,
      ...(format === "pcm" ? { sample_rate: PCM_SAMPLE_RATE } : { mp3_bitrate: 64 }),
      latency: config.tts.fishLatency,
      normalize: true,
    }),
    signal: r.signal,
  };
}

/** Streams speech as 16-bit mono PCM at 24 kHz, the same format as the ElevenLabs path, in whole samples. */
export async function* streamSpeech(r: SpeechRequest): AsyncGenerator<Uint8Array> {
  const res = await fetch(`${API}/v1/tts`, speechRequest(r, "pcm"));
  if (!res.ok || !res.body) throw await failure(res, "speech");
  yield* wholeSamples(res.body);
}

/** A whole clip as MP3, for short previews. */
export async function speechMp3(r: SpeechRequest): Promise<Buffer> {
  const res = await fetch(`${API}/v1/tts`, speechRequest(r, "mp3"));
  if (!res.ok) throw await failure(res, "speech");
  return Buffer.from(await res.arrayBuffer());
}
