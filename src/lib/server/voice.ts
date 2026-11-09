import "server-only";
import type { AvatarRecord, Persona } from "@/lib/avatar/types";
import { updateAvatar } from "./db";
import { cloneVoice, speak } from "./fal";

export const DEFAULT_VOICE = "Friendly_Person";

export function greetingFor(p: Persona): string {
  const g = p.greeting.trim();
  if (g) return g;
  const name = p.name.trim();
  return name
    ? `Hey, I'm ${name}'s AI avatar. Ask me anything about ${name}, or just say hi!`
    : "Hey there! I'm an AI avatar. Ask me anything, or just say hi!";
}

/**
 * Speaks text in the avatar's voice. Cloned voices can expire on the
 * provider side, so on failure the voice is re-cloned once from the stored
 * sample and the new id saved.
 */
export async function speakAs(record: AvatarRecord, text: string) {
  const voiceId = record.voice?.voiceId ?? DEFAULT_VOICE;
  try {
    return await speak({ text, voiceId });
  } catch (err) {
    if (record.voice?.mode !== "clone" || !record.voice.sampleUrl) throw err;
    const fresh = await cloneVoice({ audioUrl: record.voice.sampleUrl, previewText: text.slice(0, 200) });
    updateAvatar(record.id, (r) => {
      if (r.voice) r.voice = { ...r.voice, voiceId: fresh.voiceId };
    });
    return speak({ text, voiceId: fresh.voiceId });
  }
}
