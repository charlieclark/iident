import "server-only";
import { PORTRAIT_PROMPT } from "@/lib/avatar/options";
import { getAvatar, updateAvatar } from "./db";
import { generatePortrait } from "./fal";
import { download, putFile } from "./storage";

/**
 * The clean portrait a character is drawn from: made once per selfie, in the
 * background as soon as the selfie is uploaded, and awaited by whatever
 * draws first if it isn't ready yet.
 */

const g = globalThis as unknown as { __iidentPortraits?: Map<string, Promise<string | null>> };
const pending = (g.__iidentPortraits ??= new Map<string, Promise<string | null>>());

/**
 * The URL of the portrait for the avatar's current selfie, making it if
 * needed. Resolves to null when it cannot be made: drawing then falls back
 * to the selfie alone instead of failing.
 */
export function ensurePortrait(avatarId: string): Promise<string | null> {
  const selfie = getAvatar(avatarId)?.selfie;
  if (!selfie) return Promise.resolve(null);
  if (selfie.portrait) return Promise.resolve(selfie.portrait.url);
  const key = `${avatarId}:${selfie.file}`;
  const running = pending.get(key);
  if (running) return running;

  const job = (async () => {
    try {
      const url = await generatePortrait(selfie.url, PORTRAIT_PROMPT);
      const file = await putFile(avatarId, `portrait-${Date.now().toString(36)}.png`, await download(url));
      updateAvatar(avatarId, (r) => {
        // A newer selfie may have arrived while this one was being redrawn.
        if (r.selfie?.file === selfie.file) r.selfie.portrait = { file, url };
      });
      return url;
    } catch (err) {
      console.warn(`[portrait ${avatarId}]`, err);
      return null;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, job);
  return job;
}
