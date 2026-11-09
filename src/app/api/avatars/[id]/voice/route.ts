import { updateAvatar } from "@/lib/server/db";
import { cloneVoice, uploadToFal } from "@/lib/server/fal";
import { HttpError, handle, ownerView, rateLimit, requireOwner } from "@/lib/server/http";
import { putFile } from "@/lib/server/storage";
import { greetingFor } from "@/lib/server/voice";

const MAX_BYTES = 20 * 1024 * 1024;
const TYPES: Record<string, string> = { "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a" };

/** Clones the creator's voice from a recorded or uploaded sample (10s+). */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/voice">) => {
  const { id } = await ctx.params;
  rateLimit(req, "voice", 6);
  const record = requireOwner(req, id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach an audio recording.");
  if (file.size > MAX_BYTES) throw new HttpError(413, "That recording is too large (max 20 MB).");
  if (form.get("consent") !== "true") {
    throw new HttpError(400, "Please confirm this is your voice, or that you have permission to clone it.");
  }
  const ext = TYPES[file.type] ?? (file.name.split(".").pop()?.toLowerCase() || "");
  if (!["wav", "mp3", "m4a"].includes(ext)) throw new HttpError(415, "Use a WAV, MP3 or M4A recording.");

  const data = Buffer.from(await file.arrayBuffer());
  const sampleFile = await putFile(id, `voice-${Date.now().toString(36)}.${ext}`, data);
  const sampleUrl = await uploadToFal(data, file.type || `audio/${ext}`, `voice.${ext}`);
  let cloned: { voiceId: string; previewUrl?: string };
  try {
    cloned = await cloneVoice({ audioUrl: sampleUrl, previewText: greetingFor(record.persona) });
  } catch (err) {
    console.error("voice clone failed", err);
    throw new HttpError(422, "We couldn't clone that recording. Try again in a quiet room, speaking for 15 to 30 seconds.");
  }
  const updated = updateAvatar(id, (r) => {
    r.voice = { mode: "clone", voiceId: cloned.voiceId, sampleFile, sampleUrl, previewUrl: cloned.previewUrl, createdAt: Date.now() };
  });
  return Response.json({ avatar: ownerView(updated) });
});
