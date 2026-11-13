import "server-only";
import type { User } from "./auth";
import { cancelSubscription } from "./billing";
import { avatarsOwnedBy, deleteAvatarRow, getAvatar } from "./db";
import { forgetUser, track } from "./insights";
import { query } from "./pg";
import { deleteFiles } from "./storage";
import { dropCached } from "./avatarFiles";
import { freeClone } from "./voice";

/**
 * Deleting: an avatar, or an account with everything in it.
 *
 * An avatar holds a person's face and voice, so deleting it removes all of
 * it: the selfie, the portrait and drawings made from it, the 3D model, the
 * voice recording, the voice clone at the speech provider, the record, and
 * the CDN's cached copies of the model. A visitor's browser that already
 * loaded the model keeps its own copy; nothing can reach that.
 * Copies held for processing by the image service expire there on its own
 * schedule (see the privacy page).
 */
export async function deleteAvatar(id: string): Promise<boolean> {
  const record = await getAvatar(id);
  if (!record) return false;
  // The record goes first: from that moment the page, the chat and the files are unreachable.
  await deleteAvatarRow(id);
  freeClone(record.voice);
  await deleteFiles(id).catch((err) => console.warn(`[delete ${id}] files left behind:`, err));
  // The 3D model and thumbnail are public and cached by the CDN; its copies go too.
  await dropCached(id);
  await track("avatar_deleted", { avatarId: id });
  return true;
}

/**
 * Deletes an account: ends its subscription, deletes its avatars, signs it
 * out everywhere and removes it. If the subscription can't be cancelled the
 * account is left as it is, so nobody ends up paying for an account that is
 * gone.
 */
export async function deleteAccount(user: User): Promise<{ avatars: number; cancelled: boolean }> {
  const cancelled = await cancelSubscription(user.id);
  const owned = await avatarsOwnedBy(user.id);
  for (const avatar of owned) await deleteAvatar(avatar.id);
  await query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
  await query("DELETE FROM login_tokens WHERE email = $1", [user.email]);
  await query("DELETE FROM users WHERE id = $1", [user.id]);
  await forgetUser(user.id);
  await track("account_deleted");
  return { avatars: owned.length, cancelled };
}
