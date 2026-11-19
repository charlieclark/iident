import { activeProvider, presetVoices } from "@/lib/server/voice";

/** The voices a creator can pick from, for the speech provider in use. */
export async function GET() {
  return Response.json({ provider: activeProvider(), voices: presetVoices() });
}
