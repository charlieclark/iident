import "server-only";
import { deleteAtFal, FAL_KEEPS_MS, uploadToFal } from "./fal";
import { query, one } from "./pg";
import { contentTypeFor, getFile } from "./storage";

/**
 * Links to the copies fal holds of our stored files.
 *
 * The image and 3D models read their inputs from fal's own file store: the
 * selfie, the portrait and the character pictures are each used by later
 * steps. Those copies are a person's face sitting at another company, so
 * they are set to expire after a day (FAL_KEEPS_MS) rather than kept. The
 * lasting copy is the one in our storage.
 *
 * So a link is only good for a while. This remembers each one with its
 * expiry, and when a step needs a file whose link has run out (someone
 * returning to their character next week), uploads the file again.
 */

/** A link is not handed out in its last minutes: the model still has to fetch the file. */
const MARGIN_MS = 15 * 60 * 1000;

/** Notes that fal holds `file` at `url`, from now until its copy expires. */
export async function rememberFalLink(file: string, url: string, now = Date.now()): Promise<void> {
  await query("INSERT INTO fal_links (file, url, expires_at) VALUES ($1, $2, $3) ON CONFLICT (file) DO UPDATE SET url = $2, expires_at = $3", [
    file,
    url,
    now + FAL_KEEPS_MS,
  ]);
  // Now and then, forget links that have run out.
  if (Math.random() < 0.02) void query("DELETE FROM fal_links WHERE expires_at < $1", [now]).catch(() => {});
}

/**
 * A link fal can read `file` from: the remembered one while it lasts,
 * otherwise a fresh upload. `held` is the link kept with the record from
 * before links expired; it is used only when the file itself can't be read.
 */
export async function falLink(file: string, held?: string, now = Date.now()): Promise<string> {
  const row = await one<{ url: string }>("SELECT url FROM fal_links WHERE file = $1 AND expires_at > $2", [file, now + MARGIN_MS]);
  if (row) return row.url;
  const stored = await getFile(file);
  if (!stored) {
    if (held) return held;
    throw new Error(`${file} is not in storage`);
  }
  const url = await uploadToFal(stored.data, contentTypeFor(file), file.split("/").pop()!);
  await rememberFalLink(file, url, now);
  return url;
}

/**
 * Deletes fal's copies of a deleted avatar's files now, without waiting for
 * them to expire, and forgets their links. `more` are links kept elsewhere on
 * the record (the meshes of a 3D build). Never throws: whatever can't be
 * deleted now is gone within a day anyway.
 */
export async function deleteFalCopies(avatarId: string, more: (string | undefined)[] = []): Promise<void> {
  try {
    const rows = await query<{ url: string }>("DELETE FROM fal_links WHERE file LIKE $1 RETURNING url", [`${avatarId.replace(/[\\%_]/g, "\\$&")}/%`]);
    const links = new Set([...rows.map((r) => r.url), ...more.filter((u): u is string => !!u)]);
    await Promise.all([...links].map((url) => deleteAtFal(url).catch((err) => console.warn(`[fal ${avatarId}] a copy could not be deleted (it expires within a day):`, err))));
  } catch (err) {
    console.warn(`[fal ${avatarId}] copies could not be deleted (they expire within a day):`, err);
  }
}
