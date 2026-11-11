import { transcribe, uploadToFal } from "@/lib/server/fal";
import { HttpError, MAX_UPLOAD_BYTES, handle, rateLimit } from "@/lib/server/http";


/** Transcribes a short voice message from a visitor. */
export const POST = handle(async (req: Request) => {
  await rateLimit(req, "stt", 30);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "No audio received.");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "That recording is too long.");
  const type = file.type || "audio/webm";
  const ext =
    [
      ["mpeg", "mp3"],
      ["mp3", "mp3"],
      ["mp4", "m4a"],
      ["m4a", "m4a"],
      ["ogg", "ogg"],
      ["wav", "wav"],
    ].find(([needle]) => type.includes(needle))?.[1] ?? "webm";
  const url = await uploadToFal(Buffer.from(await file.arrayBuffer()), type, `message.${ext}`);
  const language = typeof form.get("language") === "string" ? String(form.get("language")) : undefined;
  const text = await transcribe(url, language || undefined);
  return Response.json({ text });
});
