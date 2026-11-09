import { z } from "zod";
import { PRESET_VOICES, speak } from "@/lib/server/fal";
import { HttpError, handle, rateLimit, requireOwner } from "@/lib/server/http";
import { greetingFor, speakAs } from "@/lib/server/voice";

const bodySchema = z.object({
  text: z.string().max(300).optional(),
  preset: z.string().max(64).optional(),
});

/** Speaks a line in the avatar's current voice, or auditions a preset voice. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/voice/preview">) => {
  const { id } = await ctx.params;
  rateLimit(req, "tts", 20);
  const record = requireOwner(req, id);
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, "Invalid preview request.");
  const text = parsed.data.text?.trim() || greetingFor(record.persona);
  if (parsed.data.preset) {
    if (!PRESET_VOICES.some((v) => v.id === parsed.data.preset)) throw new HttpError(400, "Unknown voice.");
    return Response.json(await speak({ text, voiceId: parsed.data.preset }));
  }
  return Response.json(await speakAs(record, text));
});
