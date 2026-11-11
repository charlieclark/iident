import "server-only";
import type { Database } from "./pg";

/**
 * Copies a local SQLite database from before the move to Postgres into the
 * (new, empty) embedded database, so avatars made during development are
 * still there after updating. Files on disk are untouched and keep working.
 * Safe to delete once nobody has an old `data/app.db` left.
 */
export async function importSqlite(conn: Database, file: string): Promise<void> {
  type Row = Record<string, string | number | null>;
  let read: (table: string) => Row[];
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const old = new DatabaseSync(file, { readOnly: true });
    read = (table) => {
      try {
        return old.prepare(`SELECT * FROM ${table}`).all() as Row[];
      } catch {
        return []; // older databases lack the newer tables
      }
    };
  } catch (err) {
    console.warn("[db] could not read the old SQLite database:", err);
    return;
  }
  const avatars = read("avatars");
  const users = read("users");
  const sessions = read("sessions");
  await conn.transaction(async (tx) => {
    for (const a of avatars) {
      await tx.query(
        "INSERT INTO avatars (id, slug, published, owner_id, edit_token_hash, created_at, updated_at, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) ON CONFLICT DO NOTHING",
        [a.id, a.slug, !!a.published, a.owner_id ?? null, a.edit_token_hash, a.created_at, a.updated_at, a.data],
      );
    }
    for (const u of users) {
      await tx.query("INSERT INTO users (id, email, created_at, data) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING", [u.id, u.email, u.created_at, u.data ?? "{}"]);
    }
    for (const s of sessions) {
      await tx.query("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [s.token_hash, s.user_id, s.created_at, s.expires_at]);
    }
  });
  console.info(`[db] carried over ${avatars.length} avatars and ${users.length} accounts from ${file}`);
}
