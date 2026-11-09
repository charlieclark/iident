import { activeProvider, presetVoices } from "@/lib/server/voice";

/** Stock voices for the configured speech provider (shown in the creator). */
export async function GET() {
  return Response.json({ provider: activeProvider(), voices: presetVoices() });
}
