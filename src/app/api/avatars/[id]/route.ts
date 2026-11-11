import { after } from "next/server";
import { z } from "zod";
import { backdropChoiceSchema } from "@/lib/avatar/backdrop";
import { contextSchema } from "@/lib/avatar/context";
import { appearanceSchema } from "@/lib/avatar/options";
import { updateAvatar } from "@/lib/server/db";
import { HttpError, handle, ownerView, requireOwner } from "@/lib/server/http";
import { advanceModelJob } from "@/lib/server/jobs";
import { activeProvider, freeClone, presetVoices } from "@/lib/server/voice";

/** Room for the final merge of a model, which runs after the response. */
export const maxDuration = 300;

export const GET = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]">) => {
  const { id } = await ctx.params;
  // The creator polls this while the 3D character is built, and each poll moves the build on.
  const { record, finish } = await advanceModelJob(await requireOwner(req, id));
  if (finish) after(finish);
  return Response.json({ avatar: await ownerView(record) });
});

const personaSchema = z.object({
  name: z.string().max(60),
  tagline: z.string().max(160),
  about: z.string().max(4000),
  traits: z.array(z.string().max(24)).max(8),
  speakingStyle: z.string().max(400),
  boundaries: z.string().max(1000),
  greeting: z.string().max(300),
  language: z.string().max(40),
});

const patchSchema = z.object({
  appearance: appearanceSchema.optional(),
  persona: personaSchema.optional(),
  context: contextSchema.optional(),
  backdrop: backdropChoiceSchema.optional(),
  consent: z.boolean().optional(),
  voicePreset: z.string().max(64).optional(),
});

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]">) => {
  const { id } = await ctx.params;
  const previous = (await requireOwner(req, id)).voice;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid input");
  }
  const body = parsed.data;
  if (body.voicePreset && !presetVoices().some((v) => v.id === body.voicePreset)) {
    throw new HttpError(400, "Unknown voice.");
  }
  const record = await updateAvatar(id, (r) => {
    if (body.appearance) r.appearance = body.appearance;
    if (body.persona) r.persona = body.persona;
    if (body.context) r.context = body.context;
    if (body.backdrop) r.backdrop = body.backdrop;
    if (body.consent !== undefined) r.consent = body.consent;
    if (body.voicePreset) {
      r.voice = { mode: "preset", provider: activeProvider(), voiceId: body.voicePreset, createdAt: Date.now() };
    }
  });
  // Switching to a stock voice frees the old clone (and its ElevenLabs voice slot).
  if (body.voicePreset) freeClone(previous);
  return Response.json({ avatar: await ownerView(record) });
});
