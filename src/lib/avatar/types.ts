import type { Backdrop, BackdropView } from "./backdrop";
import type { AvatarContext } from "./context";
import type { Appearance } from "./options";

export type Vec3 = [number, number, number];

/**
 * Facial landmarks located on the generated 3D model, used to drive lip sync
 * and blinks. All positions are in the skinned mesh's geometry (bind-pose)
 * space, the same space morph targets and the vertex shader work in.
 */
export type FaceRig = {
  version: 1;
  /** True when landmarks came from face detection, false for the heuristic fallback. */
  detected: boolean;
  meshName: string;
  /** Orthonormal face frame in geometry space. */
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  mouth: {
    center: Vec3;
    left: Vec3;
    right: Vec3;
    /** Inner lip contours, ordered left corner -> right corner. */
    upperInner: Vec3[];
    lowerInner: Vec3[];
    upperOuter: Vec3[];
    lowerOuter: Vec3[];
  };
  chin: Vec3;
  noseTip: Vec3;
  eyes: { left: EyeRig; right: EyeRig };
  /** Linear-ish sRGB 0..1, sampled from the texture around the face. */
  skinColor: Vec3;
  lipColor: Vec3;
};

export type EyeRig = {
  center: Vec3;
  inner: Vec3;
  outer: Vec3;
  /** Upper and lower lid contours, ordered inner -> outer. */
  upper: Vec3[];
  lower: Vec3[];
};

export const PERSONA_TRAITS = [
  "Warm",
  "Witty",
  "Curious",
  "Calm",
  "Energetic",
  "Thoughtful",
  "Direct",
  "Playful",
  "Professional",
  "Encouraging",
  "Nerdy",
  "Sarcastic",
] as const;

export type Persona = {
  name: string;
  tagline: string;
  about: string;
  traits: string[];
  speakingStyle: string;
  boundaries: string;
  greeting: string;
  language: string;
};

export const DEFAULT_PERSONA: Persona = {
  name: "",
  tagline: "",
  about: "",
  traits: ["Warm", "Curious"],
  speakingStyle: "Friendly and conversational, like chatting over coffee.",
  boundaries: "",
  greeting: "",
  language: "English",
};

export type Concept = {
  id: string;
  /** Public fal CDN URL (used as model input). */
  url: string;
  /** Local copy, served from /api/files. */
  file: string;
  prompt: string;
  /**
   * "preview": a quick, cheap draft for trying looks. "final": the
   * high-likeness render the 3D model is built from. Concepts from before
   * previews existed have no kind and count as final.
   */
  kind?: "preview" | "final";
  parentId?: string;
  createdAt: number;
};

export type ModelStage =
  | "queued"
  | "sculpting"
  | "rigging"
  | "finishing"
  | "ready"
  | "failed";

export type ModelJob = {
  status: ModelStage;
  conceptId: string;
  heightMeters: number;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  error?: string;
  /** Merged GLB (mesh + skeleton + named animation clips). */
  file?: string;
  clips?: string[];
  /** fal request ids, kept so a restarted server could resume polling. */
  requests?: Record<string, string>;
  /** Intermediate fal URLs, useful for debugging and retries. */
  sources?: Record<string, string>;
  /** This attempt reused the mesh from a failed attempt (only done once). */
  meshReused?: boolean;
};

export type SpeechProvider = "elevenlabs" | "minimax" | "fish";

export type VoiceProfile = {
  mode: "clone" | "preset";
  /** Which service the voice id belongs to. Records from before ElevenLabs support have none (MiniMax). */
  provider?: SpeechProvider;
  /** Stock voice id, or the provider's clone id. Empty for Fish clones spoken straight from the recording. */
  voiceId: string;
  sampleFile?: string;
  sampleUrl?: string;
  /** What is said in the recording; Fish needs it to clone from the recording on each request. */
  sampleText?: string;
  previewUrl?: string;
  createdAt: number;
};

/** Replies given to visitors: this calendar month (UTC, "2026-11") and all time. */
export type Usage = { month: string; replies: number; total: number };

export type AvatarRecord = {
  id: string;
  slug: string | null;
  published: boolean;
  createdAt: number;
  updatedAt: number;
  consent: boolean;
  selfie?: { file: string; url: string };
  appearance: Appearance;
  concepts: Concept[];
  selectedConceptId?: string;
  model?: ModelJob;
  faceRig?: FaceRig;
  thumbnail?: string;
  voice?: VoiceProfile;
  persona: Persona;
  /** What the avatar knows and can show (see ./context.ts). */
  context: AvatarContext;
  usage?: Usage;
  /** What sits behind the avatar on its page (see ./backdrop.ts). Midnight when unset. */
  backdrop?: Backdrop;
};

/** The subset of a record that is safe to show to anyone with the link. */
/** The persona fields a public page needs; the rest stays server-side. */
export type PublicPersona = Pick<Persona, "name" | "tagline" | "language">;

export type PublicAvatar = {
  id: string;
  slug: string;
  persona: PublicPersona;
  modelUrl: string;
  heightMeters: number;
  clips: string[];
  faceRig: FaceRig | null;
  thumbnailUrl: string | null;
  hasVoice: boolean;
  backdrop: BackdropView;
};
