import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_APPEARANCE } from "@/lib/avatar/options";
import { EMPTY_CONTEXT } from "@/lib/avatar/context";
import { DEFAULT_PERSONA, type AvatarRecord, type Persona } from "@/lib/avatar/types";
import { config } from "./config";

/**
 * Minimal persistence: one SQLite table holding each avatar as a JSON
 * document, plus indexed columns for lookups. Swap this module for Postgres
 * (or anything else) in production; nothing else touches SQL.
 */

type Row = { id: string; data: string; edit_token_hash: string };

const g = globalThis as unknown as { __iidentDb?: DatabaseSync };

function db(): DatabaseSync {
  if (g.__iidentDb) return g.__iidentDb;
  mkdirSync(config.dataDir, { recursive: true });
  const conn = new DatabaseSync(path.join(config.dataDir, "app.db"));
  conn.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS avatars (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE,
      published INTEGER NOT NULL DEFAULT 0,
      edit_token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  g.__iidentDb = conn;
  return conn;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function parse(row: Row | undefined): AvatarRecord | null {
  if (!row) return null;
  return normalizeRecord(JSON.parse(row.data));
}

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

export function createAvatar(): { record: AvatarRecord; editToken: string } {
  const id = randomBytes(9).toString("base64url");
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
  db()
    .prepare(
      "INSERT INTO avatars (id, slug, published, edit_token_hash, created_at, updated_at, data) VALUES (?, NULL, 0, ?, ?, ?, ?)",
    )
    .run(id, hashToken(editToken), now, now, JSON.stringify(record));
  return { record, editToken };
}

export function getAvatar(id: string): AvatarRecord | null {
  const row = db().prepare("SELECT id, data, edit_token_hash FROM avatars WHERE id = ?").get(id) as
    | Row
    | undefined;
  return parse(row ? { ...row } : undefined);
}

export function getAvatarBySlug(slug: string): AvatarRecord | null {
  const row = db()
    .prepare("SELECT id, data, edit_token_hash FROM avatars WHERE slug = ? AND published = 1")
    .get(slug.toLowerCase()) as Row | undefined;
  return parse(row ? { ...row } : undefined);
}

export function verifyEditToken(id: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const row = db().prepare("SELECT edit_token_hash FROM avatars WHERE id = ?").get(id) as
    | { edit_token_hash: string }
    | undefined;
  if (!row) return false;
  const a = Buffer.from(row.edit_token_hash, "hex");
  const b = Buffer.from(hashToken(token), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Read-modify-write a record. SQLite access is synchronous, so within one
 * Node process the callback runs without interleaving.
 */
export function updateAvatar(
  id: string,
  mutate: (record: AvatarRecord) => AvatarRecord | void,
): AvatarRecord {
  const current = getAvatar(id);
  if (!current) throw new Error(`Avatar ${id} not found`);
  const draft = structuredClone(current);
  const next = (mutate(draft) ?? draft) as AvatarRecord;
  next.updatedAt = Date.now();
  db()
    .prepare("UPDATE avatars SET slug = ?, published = ?, updated_at = ?, data = ? WHERE id = ?")
    .run(next.slug, next.published ? 1 : 0, next.updatedAt, JSON.stringify(next), id);
  return next;
}

export function isSlugTaken(slug: string, exceptId?: string): boolean {
  const row = db().prepare("SELECT id FROM avatars WHERE slug = ?").get(slug.toLowerCase()) as
    | { id: string }
    | undefined;
  return !!row && row.id !== exceptId;
}
