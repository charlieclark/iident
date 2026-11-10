import { config } from "@/lib/server/config";
import { activeProvider, presetVoices } from "@/lib/server/voice";

/** Stock voices for the configured speech provider, and whether cloning is offered (shown in the creator). */
export async function GET() {
  return Response.json({ provider: activeProvider(), voices: presetVoices(), cloning: config.voiceCloning });
}
