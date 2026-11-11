import "server-only";
import { createFalClient, type FalClient } from "@fal-ai/client";
import { config, requireFal } from "./config";

/**
 * Thin, typed wrappers around the fal endpoints the app uses. Every call goes
 * through fal's queue (queue.fal.run). Calls that finish within a request
 * (images, speech) wait for their result here; the 3D steps are submitted
 * and collected separately (see `submitMesh`).
 */

let client: FalClient | null = null;
function fal(): FalClient {
  requireFal();
  client ??= createFalClient({ credentials: config.falKey });
  return client;
}

type FalFile = { url: string; content_type?: string; file_size?: number | null };

async function run<T>(
  endpoint: string,
  input: Record<string, unknown>,
  opts: { pollInterval?: number } = {},
): Promise<T> {
  const result = await fal().subscribe(endpoint, { input, pollInterval: opts.pollInterval ?? 1000 });
  return result.data as T;
}

export async function uploadToFal(data: Uint8Array | Buffer, contentType: string, name: string) {
  const blob = new Blob([new Uint8Array(data)], { type: contentType });
  const file = new File([blob], name, { type: contentType });
  return fal().storage.upload(file);
}

/** Each image model family takes its size and quality settings differently. */
export function imageEditInput(
  model: string,
  prompt: string,
  imageUrls: string[],
  quality = config.models.conceptQuality,
  /** "figure" is a tall full-body picture, "portrait" a square head and shoulders. */
  shape: "figure" | "portrait" = "figure",
): Record<string, unknown> {
  const base = { prompt, image_urls: imageUrls, num_images: 1, output_format: "png" };
  const square = shape === "portrait";
  if (model.includes("gpt-image")) {
    // Low reasoning effort: planning adds latency and is for dense text and layouts.
    return { ...base, image_size: { width: 1024, height: square ? 1024 : 1536 }, quality, reasoning_effort: "low" };
  }
  // The prompt is already complete; letting the model rewrite it doubles the wait (about 6 s instead of 2.5 s).
  if (model.includes("flux")) return { ...base, image_size: { width: square ? 768 : 576, height: square ? 768 : 1024 }, enable_prompt_expansion: false };
  return { ...base, aspect_ratio: square ? "1:1" : "9:16", resolution: "1K" }; // Nano Banana family
}

/** Selfie -> the same person as a straight-on, evenly lit portrait with a relaxed face. */
export async function generatePortrait(selfieUrl: string, prompt: string): Promise<string> {
  const model = config.models.portrait;
  const out = await run<{ images?: FalFile[] }>(model, imageEditInput(model, prompt, [selfieUrl], "high", "portrait"), { pollInterval: 400 });
  const url = out.images?.[0]?.url;
  if (!url) throw new Error("The image model returned no image");
  return url;
}

/**
 * Reference image(s) + prompt -> one full-body character image. "main" is
 * the model that draws the person in the house style (at the final quality
 * unless told otherwise); "sketch" is the fast, cheap one.
 */
export async function generateCharacterImage(params: {
  engine: "main" | "sketch";
  imageUrls: string[];
  prompt: string;
  quality?: string;
}): Promise<string> {
  const model = params.engine === "sketch" ? config.models.preview : config.models.concept;
  const out = await run<{ images?: FalFile[] }>(model, imageEditInput(model, params.prompt, params.imageUrls, params.quality), { pollInterval: 400 });
  const url = out.images?.[0]?.url;
  if (!url) throw new Error("The image model returned no image");
  return url;
}

/** Description -> a square backdrop image (cropped to fit any screen). */
export async function generateBackdrop(prompt: string): Promise<string> {
  const out = await run<{ images?: FalFile[] }>(
    config.models.backdrop,
    { prompt, image_size: { width: 1024, height: 1024 }, num_images: 1, output_format: "jpeg", enable_prompt_expansion: false },
    { pollInterval: 400 },
  );
  const url = out.images?.[0]?.url;
  if (!url) throw new Error("The image model returned no image");
  return url;
}

/**
 * The 3D steps take minutes, longer than one serverless request may run. So
 * they are submitted to fal's queue and collected later: `submit*` returns
 * the request id to keep, `*Result` returns null while the request is still
 * running and throws if it failed.
 */
async function submit(endpoint: string, input: Record<string, unknown>, webhookUrl?: string): Promise<string> {
  const { request_id } = await fal().queue.submit(endpoint, { input, webhookUrl });
  return request_id;
}

async function collect<T>(endpoint: string, requestId: string): Promise<T | null> {
  const { status } = await fal().queue.status(endpoint, { requestId });
  if (status !== "COMPLETED") return null;
  return (await fal().queue.result(endpoint, { requestId })).data as T;
}

/** Character sheet -> textured mesh in A-pose (no rig yet). */
export function submitMesh(imageUrl: string, webhookUrl?: string): Promise<string> {
  // Meshy's faster "Smart Topology" models (t2, t2.5) cap out at 15k triangles
  // and take fewer options; the standard models get a denser mesh, which
  // gives the face rig more vertices around the mouth.
  const smartTopology = /\/t2(\.\d+)?\//.test(config.models.imageTo3d);
  const input = smartTopology
    ? { image_url: imageUrl, pose_mode: "a-pose", target_polycount: 15000, should_texture: true }
    : {
        image_url: imageUrl,
        pose_mode: "a-pose",
        topology: "triangle",
        target_polycount: 40000,
        symmetry_mode: "auto",
        should_texture: true,
        enable_pbr: false,
      };
  return submit(config.models.imageTo3d, input, webhookUrl);
}

export async function meshResult(requestId: string): Promise<{ glbUrl: string } | null> {
  const out = await collect<{ model_glb?: FalFile | null }>(config.models.imageTo3d, requestId);
  if (!out) return null;
  if (!out.model_glb?.url) throw new Error("The 3D service returned no model");
  return { glbUrl: out.model_glb.url };
}

/**
 * Animation presets from Meshy's library, requested in one rigging call.
 * Ids come from https://docs.meshy.ai/api/animation-library.
 */
export const ANIMATION_CLIPS = [
  { name: "idle", actionId: 0 },
  { name: "wave", actionId: 290 }, // Wave_One_Hand
  { name: "talk_open", actionId: 313 }, // Talk_with_Hands_Open
  { name: "talk_right", actionId: 314 }, // Talk_with_Right_Hand_Open
  { name: "agree", actionId: 25 }, // Agree_Gesture
  { name: "think", actionId: 36 }, // Confused_Scratch
  { name: "listen", actionId: 47 }, // Listening_Gesture
  { name: "shrug", actionId: 317 }, // Shrug
] as const;

/** Mesh -> humanoid rig plus the animation clips above. */
export function submitRig(params: { glbUrl: string; heightMeters: number }, webhookUrl?: string): Promise<string> {
  return submit(
    config.models.rigging,
    { model_url: params.glbUrl, height_meters: params.heightMeters, animation_action_ids: ANIMATION_CLIPS.map((c) => c.actionId) },
    webhookUrl,
  );
}

export async function rigResult(requestId: string): Promise<{ riggedGlbUrl: string; clips: { name: string; glbUrl: string }[] } | null> {
  const out = await collect<{
    rigged_character_glb?: FalFile | null;
    animations?: { action_id: number; animation_glb?: FalFile | null }[];
  }>(config.models.rigging, requestId);
  if (!out) return null;
  if (!out.rigged_character_glb?.url) throw new Error("Rigging returned no character");
  const clips: { name: string; glbUrl: string }[] = [];
  for (const anim of out.animations ?? []) {
    const def = ANIMATION_CLIPS.find((c) => c.actionId === anim.action_id);
    if (def && anim.animation_glb?.url) clips.push({ name: def.name, glbUrl: anim.animation_glb.url });
  }
  return { riggedGlbUrl: out.rigged_character_glb.url, clips };
}

/** Preset voices available without cloning (MiniMax system voices). */
export const PRESET_VOICES = [
  { id: "Friendly_Person", label: "Friendly" },
  { id: "Calm_Woman", label: "Calm (female)" },
  { id: "Casual_Guy", label: "Casual (male)" },
  { id: "Wise_Woman", label: "Wise (female)" },
  { id: "Deep_Voice_Man", label: "Deep (male)" },
  { id: "Lively_Girl", label: "Lively (female)" },
  { id: "Patient_Man", label: "Patient (male)" },
  { id: "Inspirational_girl", label: "Inspiring (female)" },
  { id: "Elegant_Man", label: "Elegant (male)" },
] as const;

export async function cloneVoice(params: {
  audioUrl: string;
  previewText: string;
}): Promise<{ voiceId: string; previewUrl?: string }> {
  const out = await run<{ custom_voice_id: string; audio?: FalFile | null }>(config.models.voiceClone, {
    audio_url: params.audioUrl,
    text: params.previewText.slice(0, 900),
    model: "speech-02-turbo",
    noise_reduction: true,
    need_volume_normalization: true,
  });
  if (!out.custom_voice_id) throw new Error("Voice cloning returned no voice id");
  return { voiceId: out.custom_voice_id, previewUrl: out.audio?.url };
}

export async function speak(params: {
  text: string;
  voiceId: string;
  speed?: number;
}): Promise<{ url: string; durationMs: number }> {
  const out = await run<{ audio: FalFile; duration_ms: number }>(
    config.models.tts,
    {
      prompt: params.text,
      output_format: "url",
      voice_setting: { voice_id: params.voiceId, speed: params.speed ?? 1, vol: 1, pitch: 0 },
      audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 },
    },
    { pollInterval: 250 },
  );
  return { url: out.audio.url, durationMs: out.duration_ms };
}

export async function transcribe(audioUrl: string, languageCode?: string): Promise<string> {
  const model = config.models.stt;
  // Whisper-style endpoints (wizper) accept browser WebM recordings; the
  // ElevenLabs Scribe endpoints need mp3/wav/m4a/ogg/flac/aac.
  const input = model.includes("wizper")
    ? { audio_url: audioUrl, task: "transcribe", language: languageCode || "en", chunk_level: "segment" }
    : {
        audio_url: audioUrl,
        diarize: false,
        tag_audio_events: false,
        ...(languageCode ? { language_code: languageCode } : {}),
      };
  const out = await run<{ text: string }>(model, input, { pollInterval: 250 });
  return (out.text ?? "").trim();
}
