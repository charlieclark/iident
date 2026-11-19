import { config } from "@/lib/server/config";
import { updateAvatar } from "@/lib/server/db";
import { HttpError, MAX_UPLOAD_BYTES, handle, ownerView, rateLimit, requireOwner } from "@/lib/server/http";
import { cloneRecording } from "@/lib/server/voice";
import { saveFile } from "@/lib/server/avatarFiles";

/** Cloning a voice can take a minute. */
export const maxDuration = 300;

const TYPES: Record<string, string> = { "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a" };

/** Clones the creator's voice from a recorded or uploaded sample (10s+). */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/avatars/[id]/voice">) => {
  const { id } = await ctx.params;
  if (!config.voiceCloning) throw new HttpError(403, "Voice cloning is turned off. Pick a stock voice instead.");
  await rateLimit(req, "voice", 6);
  const record = await requireOwner(req, id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach an audio recording.");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "That recording is too large (max 4 MB).");
  if (form.get("consent") !== "true") {
    throw new HttpError(400, "Please confirm this is your voice, or that you have permission to clone it.");
  }
  const ext = TYPES[file.type] ?? (file.name.split(".").pop()?.toLowerCase() || "");
  if (!["wav", "mp3", "m4a"].includes(ext)) throw new HttpError(415, "Use a WAV, MP3 or M4A recording.");

  const data = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || `audio/${ext}`;
  // The original recording is kept so the voice can be re-cloned later
  // (for example after switching speech providers).
  const sampleFile = await saveFile(id, `voice-${Date.now().toString(36)}.${ext}`, data);

  try {
    const voice = await cloneRecording(record, { data, filename: `voice.${ext}`, contentType, file: sampleFile });
    const updated = await updateAvatar(id, (r) => {
      r.voice = voice;
    });
    return Response.json({ avatar: await ownerView(updated) });
  } catch (err) {
    console.error("voice clone failed", err);
    throw new HttpError(422, "We couldn't clone that recording. Try again in a quiet room, speaking for 15 to 30 seconds.");
  }
});
