import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DEFAULT_APPEARANCE } from "@/lib/avatar/options";
import { EMPTY_CONTEXT } from "@/lib/avatar/context";
import { DEFAULT_PERSONA, type AvatarRecord, type Persona } from "@/lib/avatar/types";
import { one, query, transaction } from "./pg";

/**
 * Avatars in Postgres: each one is a JSON document, with the fields that are
 * looked up (slug, owner) or must be unique as columns beside it. Nothing
 * outside this folder writes SQL for avatars.
 */

type Row = { data: StoredRecord; edit_token_hash: string; owner_id: string | null };

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

type StoredRecord = Omit<AvatarRecord, "persona" | "context"> & {
  persona: Persona & { knowledge?: string };
  context?: AvatarRecord["context"];
};

/**
 * Brings records saved by earlier versions up to the current shape. The
 * persona used to carry the avatar's knowledge; it now lives in `context`
 * next to the items the avatar can show.
 */
export function normalizeRecord(stored: StoredRecord): AvatarRecord {
  const { knowledge, ...persona } = stored.persona;
  return { ...stored, persona, context: stored.context ?? { ...EMPTY_CONTEXT, knowledge: knowledge ?? "" } };
}

/**
 * Avatar ids double as storage folder names, which must start with a letter
 * or digit. Random base64url starts with "-" or "_" about 3% of the time, and
 * every upload for such an avatar used to fail.
 */
export function newAvatarId(): string {
  for (;;) {
    const id = randomBytes(9).toString("base64url");
    if (/^[a-zA-Z0-9]/.test(id)) return id;
  }
}

/** JSONB cannot hold NUL characters, which can arrive in pasted text. */
const toJson = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === "string" && v.includes("\0") ? v.replaceAll("\0", "") : v));

export async function createAvatar(ownerId?: string): Promise<{ record: AvatarRecord; editToken: string }> {
  const id = newAvatarId();
  const editToken = randomBytes(24).toString("base64url");
  const now = Date.now();
  const record: AvatarRecord = {
    id,
    slug: null,
    published: false,
    createdAt: now,
    updatedAt: now,
    consent: false,
    appearance: DEFAULT_APPEARANCE,
    concepts: [],
    persona: DEFAULT_PERSONA,
    context: EMPTY_CONTEXT,
  };
  await query(
    "INSERT INTO avatars (id, slug, published, owner_id, edit_token_hash, created_at, updated_at, data) VALUES ($1, NULL, FALSE, $2, $3, $4, $4, $5::jsonb)",
    [id, ownerId ?? null, hashToken(editToken), now, toJson(record)],
  );
  return { record, editToken };
}

const COLUMNS = "data, edit_token_hash, owner_id";

export type LoadedAvatar = { record: AvatarRecord; editTokenHash: string; ownerId: string | null };

const loaded = (row: Row | undefined): LoadedAvatar | null =>
  row ? { record: normalizeRecord(row.data), editTokenHash: row.edit_token_hash, ownerId: row.owner_id } : null;

/** An avatar together with what decides who may edit it, in one query. */
export async function loadAvatar(id: string): Promise<LoadedAvatar | null> {
  return loaded(await one<Row>(`SELECT ${COLUMNS} FROM avatars WHERE id = $1`, [id]));
}

export async function getAvatar(id: string): Promise<AvatarRecord | null> {
  return (await loadAvatar(id))?.record ?? null;
}

export async function getAvatarBySlug(slug: string): Promise<AvatarRecord | null> {
  return loaded(await one<Row>(`SELECT ${COLUMNS} FROM avatars WHERE slug = $1 AND published`, [slug.toLowerCase()]))?.record ?? null;
}

/** Whether `token` is the edit token whose hash is stored with an avatar. */
export function tokenMatches(editTokenHash: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(editTokenHash, "hex");
  const b = Buffer.from(hashToken(token), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function verifyEditToken(id: string, token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const row = await one<{ edit_token_hash: string }>("SELECT edit_token_hash FROM avatars WHERE id = $1", [id]);
  return !!row && tokenMatches(row.edit_token_hash, token);
}

/**
 * Read-modify-write a record. The row is locked for the duration, so
 * concurrent updates (from any server instance) apply one after another and
 * `mutate` always sees the latest record. Keep `mutate` synchronous and free
 * of side effects. Returning `false` leaves the record as it is.
 */
export async function updateAvatar(id: string, mutate: (record: AvatarRecord) => AvatarRecord | void | false): Promise<AvatarRecord> {
  return transaction(async (tx) => {
    const [row] = await tx.query<{ data: StoredRecord }>("SELECT data FROM avatars WHERE id = $1 FOR UPDATE", [id]);
    if (!row) throw new Error(`Avatar ${id} not found`);
    const current = normalizeRecord(row.data);
    const draft = structuredClone(current);
    const result = mutate(draft);
    if (result === false) return current;
    const next = result ?? draft;
    next.updatedAt = Date.now();
    await tx.query("UPDATE avatars SET slug = $2, published = $3, updated_at = $4, data = $5::jsonb WHERE id = $1", [id, next.slug, next.published, next.updatedAt, toJson(next)]);
    return next;
  });
}

export async function isSlugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const row = await one<{ id: string }>("SELECT id FROM avatars WHERE slug = $1", [slug.toLowerCase()]);
  return !!row && row.id !== exceptId;
}

/** The account an avatar belongs to, if it has been attached to one. */
export async function avatarOwner(id: string): Promise<string | null> {
  return (await one<{ owner_id: string | null }>("SELECT owner_id FROM avatars WHERE id = $1", [id]))?.owner_id ?? null;
}

/** Attaches an avatar to an account unless it already belongs to one. Returns whether it is now theirs. */
export async function claimAvatar(id: string, userId: string): Promise<boolean> {
  const row = await one<{ owner_id: string | null }>("UPDATE avatars SET owner_id = COALESCE(owner_id, $2) WHERE id = $1 RETURNING owner_id", [id, userId]);
  return row?.owner_id === userId;
}

export async function avatarsOwnedBy(userId: string): Promise<AvatarRecord[]> {
  const rows = await query<Row>(`SELECT ${COLUMNS} FROM avatars WHERE owner_id = $1 ORDER BY updated_at DESC`, [userId]);
  return rows.map((row) => normalizeRecord(row.data));
}
