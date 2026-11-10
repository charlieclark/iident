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
  fishKey: env("FISH_API_KEY"),

  /**
   * Sign-in emails go through Resend when a key is set. Without one (local
   * development) the sign-in link is logged and returned to the page instead.
   */
  email: {
    resendKey: env("RESEND_API_KEY"),
    from: env("EMAIL_FROM", "iident <login@example.com>")!,
  },

  /**
   * Payments. With no secret key, billing is off: nothing is paywalled and
   * the limits below in `limits` apply to every avatar.
   */
  stripe: {
    secretKey: env("STRIPE_SECRET_KEY"),
    webhookSecret: env("STRIPE_WEBHOOK_SECRET"),
    apiBase: env("STRIPE_API_BASE", "https://api.stripe.com")!,
    /** Price ids from the Stripe dashboard. Without them checkout charges the plan's listed price directly. */
    prices: { creator: env("STRIPE_PRICE_CREATOR"), pro: env("STRIPE_PRICE_PRO") },
    /** Accounts that get Pro without paying (comma-separated emails). */
    compEmails: (env("COMP_EMAILS") ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  },

  /**
   * Speech providers.
   * - `provider` speaks stock voices. ElevenLabs streams audio (first sound in
   *   ~250 ms) and is used whenever a key is set; MiniMax on fal is the
   *   fallback, which returns whole clips through fal's queue.
   * - `cloneProvider` holds and speaks cloned voices. Fish Audio is preferred
   *   when its key is set: it has no voice slots, where every ElevenLabs clone
   *   takes one (30 on the Creator plan) plus a monthly quota of new clones.
   */
  tts: {
    provider: (env("TTS_PROVIDER") ?? (env("ELEVENLABS_API_KEY") ? "elevenlabs" : "minimax")) as
      | "elevenlabs"
      | "minimax",
    cloneProvider: (env("CLONE_PROVIDER") ??
      (env("FISH_API_KEY") ? "fish" : env("ELEVENLABS_API_KEY") ? "elevenlabs" : "minimax")) as
      | "fish"
      | "elevenlabs"
      | "minimax",
    elevenLabsModel: env("ELEVENLABS_MODEL", "eleven_v4_turbo")!,
    fishModel: env("FISH_MODEL", "s2.1-pro")!,
    /**
     * "inline" sends the creator's recording with every request, so nothing
     * is stored at Fish and there is no limit. "model" saves it once as a
     * private voice model; Fish caps API-created models by prepaid credit.
     */
    fishVoiceMode: env("FISH_VOICE_MODE", "inline") as "inline" | "model",
    /** "balanced" favors time to first audio; "normal" favors stability. */
    fishLatency: env("FISH_LATENCY", "balanced")!,
  },

  /**
   * Cloning a creator's voice from a recording. On unless VOICE_CLONING=off,
   * a switch for turning it off quickly: then avatars speak with stock
   * voices, recordings are refused and existing clones are never spoken.
   */
  voiceCloning: env("VOICE_CLONING") !== "off",

  limits: {
    /**
     * Replies one avatar may give visitors per calendar month; 0 means no
     * limit. A reply costs roughly 1 to 2 cents (model call plus speech), so
     * the default caps an avatar at a few dollars a month.
     */
    monthlyReplies: Number(env("MONTHLY_REPLY_LIMIT", "300")),
  },

  models: {
    /**
     * Selfie + look -> the final full-body character image the 3D model is
     * built from. GPT Image 2.6 kept faces far better than the alternatives
     * in a six-face bake-off (docs/character-pipeline.md), in about 25 s.
     */
    concept: env("FAL_CONCEPT_MODEL", "openai/gpt-image-2.6/flare/edit")!,
    conceptQuality: env("CONCEPT_QUALITY", "high")!,
    /** Quick drafts while trying looks: under a cent and a few seconds each. */
    preview: env("FAL_PREVIEW_MODEL", "blackforestlabs/flux-3/klein/edit-image")!,
    /** Backdrop scenes from a description (under a cent each). */
    backdrop: env("FAL_BACKDROP_MODEL", "blackforestlabs/flux-3/klein/text-to-image")!,
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
