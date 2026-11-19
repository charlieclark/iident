import "server-only";
import { one } from "./pg";
import { deleteFiles, putFile } from "./storage";

/** The tag the CDN keeps an avatar's public files under (its 3D model, thumbnail and backdrop). */
export const cacheTag = (avatarId: string) => `avatar-${avatarId}`;

/**
 * Makes the CDN drop its copies of an avatar's public files. They are cached
 * there for a year, so without this a deleted or taken-down avatar's 3D model
 * would go on being served from its old address. Does nothing off Vercel,
 * where nothing is cached in front of the app.
 */
export async function dropCached(avatarId: string): Promise<void> {
  try {
    const { dangerouslyDeleteByTag } = await import("@vercel/functions");
    await dangerouslyDeleteByTag(cacheTag(avatarId));
  } catch (err) {
    console.warn(`[files ${avatarId}] cached copies could not be dropped:`, err);
  }
}

/**
 * Stores a file for an avatar, unless the avatar has been deleted meanwhile.
 *
 * Drawing a face or building a model takes seconds to minutes, in the
 * background. If the person deletes their avatar while that is under way,
 * the result must not be left behind in storage: it is a picture of them.
 * So after writing, the avatar is checked, and if it is gone, so is the file.
 */
export async function saveFile(avatarId: string, name: string, data: Uint8Array | Buffer): Promise<string> {
  const key = await putFile(avatarId, name, data);
  if (!(await one("SELECT 1 FROM avatars WHERE id = $1", [avatarId]))) {
    await deleteFiles(avatarId).catch(() => {});
    throw new Error(`Avatar ${avatarId} was deleted`);
  }
  return key;
}
