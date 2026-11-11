import { z } from "zod";
import { HttpError, handle, rateLimit, requireOwner } from "@/lib/server/http";
import { greetingFor, presetVoices, previewClip } from "@/lib/server/voice";

const bodySchema = z.object({
  text: z.string().max(300).optional(),
  preset: z.string().max(64).optional(),
});

/** Speaks a line in the avatar's current voice, or auditions a stock voice. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/voice/preview">) => {
  const { id } = await ctx.params;
  await rateLimit(req, "tts", 20);
  const record = await requireOwner(req, id);
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, "Invalid preview request.");
  const text = parsed.data.text?.trim() || greetingFor(record.persona);
  const preset = parsed.data.preset;
  if (preset && !presetVoices().some((v) => v.id === preset)) throw new HttpError(400, "Unknown voice.");
  return Response.json(await previewClip(record, text, preset));
});
