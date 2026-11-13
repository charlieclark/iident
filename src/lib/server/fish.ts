import "server-only";
import { encode } from "@msgpack/msgpack";
import { config, HttpError } from "./config";
import { wholeSamples } from "./pcm";

/**
 * Fish Audio: voice cloning without voice slots, plus streaming text to speech.
 *
 * Two ways to speak in a creator's voice:
 * - inline: the recording and its transcript go with every request, so
 *   nothing is stored at Fish and there is no limit on voices;
 * - model: the recording is saved once as a private "fast" voice model and
 *   referenced by id. Fish caps how many models the API can create by the
 *   account's prepaid credit. A model is only a cache of the recording
 *   Twiins keeps, so one that goes missing is rebuilt from it.
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

/** A recording and exactly what is said in it, for cloning on each request. */
export type FishReference = { audio: Uint8Array; text: string };

/** A saved voice model, or a reference sent with the request. */
export type FishVoice = { modelId: string } | { reference: FishReference };

type SpeechRequest = { text: string; voice: FishVoice; signal?: AbortSignal };

function speechRequest(r: SpeechRequest, format: "pcm" | "mp3"): RequestInit {
  const body = {
    text: r.text,
    format,
    ...(format === "pcm" ? { sample_rate: config.tts.fishSampleRate } : { mp3_bitrate: 128 }),
    latency: config.tts.fishLatency,
    normalize: true,
  };
  const headers = { authorization: `Bearer ${apiKey()}`, model: config.tts.fishModel };
  if ("reference" in r.voice) {
    // Binary reference audio is only accepted as MessagePack.
    return {
      method: "POST",
      headers: { ...headers, "content-type": "application/msgpack" },
      body: new Uint8Array(encode({ ...body, references: [r.voice.reference] })),
      signal: r.signal,
    };
  }
  return {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ ...body, reference_id: r.voice.modelId }),
    signal: r.signal,
  };
}

/** Streams speech as 16-bit mono PCM at `config.tts.fishSampleRate`, in whole samples. */
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
