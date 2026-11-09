import { z } from "zod";
import { appearanceSchema } from "@/lib/avatar/options";
import { getAvatar, updateAvatar } from "@/lib/server/db";
import { deleteVoice } from "@/lib/server/elevenlabs";
import { HttpError, handle, ownerView, requireOwner } from "@/lib/server/http";
import { reconcileJob } from "@/lib/server/jobs";
import { activeProvider, presetVoices } from "@/lib/server/voice";

export const GET = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]">) => {
  const { id } = await ctx.params;
  requireOwner(req, id);
  const record = reconcileJob(id);
  if (!record) throw new HttpError(404, "Avatar not found.");
  return Response.json({ avatar: ownerView(record) });
});

const personaSchema = z.object({
  name: z.string().max(60),
  tagline: z.string().max(160),
  about: z.string().max(4000),
  traits: z.array(z.string().max(24)).max(8),
  speakingStyle: z.string().max(400),
  knowledge: z.string().max(8000),
  boundaries: z.string().max(1000),
  greeting: z.string().max(300),
  language: z.string().max(40),
});

const patchSchema = z.object({
  appearance: appearanceSchema.optional(),
  persona: personaSchema.optional(),
  consent: z.boolean().optional(),
  voicePreset: z.string().max(64).optional(),
});

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]">) => {
  const { id } = await ctx.params;
  requireOwner(req, id);
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid input");
  const body = parsed.data;
  if (body.voicePreset && !presetVoices().some((v) => v.id === body.voicePreset)) {
    throw new HttpError(400, "Unknown voice.");
  }
  const previous = getAvatar(id)?.voice;
  const record = updateAvatar(id, (r) => {
    if (body.appearance) r.appearance = body.appearance;
    if (body.persona) r.persona = body.persona;
    if (body.consent !== undefined) r.consent = body.consent;
    if (body.voicePreset) {
      r.voice = { mode: "preset", provider: activeProvider(), voiceId: body.voicePreset, createdAt: Date.now() };
    }
  });
  // Switching to a stock voice frees the old clone's ElevenLabs voice slot.
  if (body.voicePreset && previous?.provider === "elevenlabs" && previous.mode === "clone") {
    deleteVoice(previous.voiceId).catch((err) => console.warn("Could not free old voice", err));
  }
  return Response.json({ avatar: ownerView(record) });
});
