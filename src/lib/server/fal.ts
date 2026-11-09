import "server-only";
import { createFalClient, type FalClient } from "@fal-ai/client";
import { config, requireFal } from "./config";

/**
 * Thin, typed wrappers around the fal endpoints the app uses. Every call goes
 * through fal's queue (queue.fal.run) so long jobs survive slow starts.
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
  opts: { onEnqueue?: (requestId: string) => void; pollInterval?: number } = {},
): Promise<T> {
  const result = await fal().subscribe(endpoint, {
    input,
    pollInterval: opts.pollInterval ?? 1000,
    onEnqueue: opts.onEnqueue,
  });
  return result.data as T;
}

export async function uploadToFal(data: Uint8Array | Buffer, contentType: string, name: string) {
  const blob = new Blob([new Uint8Array(data)], { type: contentType });
  const file = new File([blob], name, { type: contentType });
  return fal().storage.upload(file);
}

/** Selfie (+ prompt) -> full-body character sheet(s). */
export async function generateConcepts(params: {
  imageUrls: string[];
  prompt: string;
  count: number;
}): Promise<string[]> {
  const out = await run<{ images: FalFile[] }>(config.models.concept, {
    image_urls: params.imageUrls,
    prompt: params.prompt,
    num_images: params.count,
    aspect_ratio: "9:16",
    output_format: "png",
    resolution: "1K",
  });
  if (!out.images?.length) throw new Error("The image model returned no images");
  return out.images.map((img) => img.url);
}

/** Character sheet -> textured mesh in A-pose (no rig yet). */
export async function generateMesh(
  imageUrl: string,
  onEnqueue?: (id: string) => void,
): Promise<{ glbUrl: string; thumbnailUrl?: string }> {
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
  const out = await run<{ model_glb: FalFile; thumbnail?: FalFile | null }>(config.models.imageTo3d, input, {
    onEnqueue,
    pollInterval: 3000,
  });
  return { glbUrl: out.model_glb.url, thumbnailUrl: out.thumbnail?.url };
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

export async function rigAndAnimate(params: {
  glbUrl: string;
  heightMeters: number;
  onEnqueue?: (id: string) => void;
}): Promise<{ riggedGlbUrl: string; clips: { name: string; glbUrl: string }[] }> {
  const out = await run<{
    rigged_character_glb?: FalFile | null;
    animations?: { action_id: number; animation_glb?: FalFile | null }[];
  }>(
    config.models.rigging,
    {
      model_url: params.glbUrl,
      height_meters: params.heightMeters,
      animation_action_ids: ANIMATION_CLIPS.map((c) => c.actionId),
    },
    { onEnqueue: params.onEnqueue, pollInterval: 3000 },
  );
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
