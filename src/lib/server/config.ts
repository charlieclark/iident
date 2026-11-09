import "server-only";
import path from "node:path";

const env = (name: string, fallback?: string) => process.env[name]?.trim() || fallback;

/**
 * Central place for every tunable. Model ids are configurable so a newer
 * fal endpoint can be swapped in without code changes.
 */
export const config = {
  dataDir: path.resolve(/*turbopackIgnore: true*/ process.cwd(), env("DATA_DIR", "data")!),
  appUrl: env("NEXT_PUBLIC_APP_URL", "http://localhost:3000")!,

  falKey: env("FAL_KEY"),
  anthropicKey: env("ANTHROPIC_API_KEY"),
  elevenLabsKey: env("ELEVENLABS_API_KEY"),

  /**
   * Speech provider. ElevenLabs streams audio (first sound in ~250 ms) and is
   * used whenever a key is set; MiniMax on fal is the fallback, which returns
   * whole clips through fal's queue (several seconds per sentence).
   */
  tts: {
    provider: (env("TTS_PROVIDER") ?? (env("ELEVENLABS_API_KEY") ? "elevenlabs" : "minimax")) as
      | "elevenlabs"
      | "minimax",
    elevenLabsModel: env("ELEVENLABS_MODEL", "eleven_v4_turbo")!,
  },

  models: {
    /** Selfie + outfit -> full-body character sheet. */
    concept: env("FAL_CONCEPT_MODEL", "fal-ai/nano-banana-2/edit")!,
    conceptVariants: Number(env("CONCEPT_VARIANTS", "2")),
    /** Character sheet -> textured A-pose mesh. */
    imageTo3d: env("FAL_IMAGE_TO_3D_MODEL", "meshy/v7.1/image-to-3d")!,
    /** Mesh -> humanoid rig + animation clips. */
    rigging: env("FAL_RIGGING_MODEL", "fal-ai/meshy/rigging/multi-animation")!,
    voiceClone: env("FAL_VOICE_CLONE_MODEL", "fal-ai/minimax/voice-clone")!,
    tts: env("FAL_TTS_MODEL", "fal-ai/minimax/speech-2.8-turbo")!,
    stt: env("FAL_STT_MODEL", "fal-ai/wizper")!,
    /** Claude model for the persona's conversation. */
    chat: env("AVATAR_CHAT_MODEL", "claude-opus-5-5")!,
  },
};

export function requireFal() {
  if (!config.falKey) {
    throw new HttpError(
      503,
      "FAL_KEY is not set. Add it to .env.local to enable avatar generation and voice.",
    );
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
