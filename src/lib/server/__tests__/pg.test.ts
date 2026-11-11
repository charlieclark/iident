import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { freshDatabase } from "../../../../test/database";

describe("database setup", () => {
  beforeAll(async () => {
    await freshDatabase("pg");
  });

  it("creates the schema once and records it", async () => {
    const pg = await import("../pg");
    const { MIGRATIONS } = await import("../schema");
    expect(await pg.query("SELECT version FROM schema_migrations ORDER BY version")).toEqual(MIGRATIONS.map((_, i) => ({ version: i + 1 })));
    const tables = (await pg.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).map((t) => t.tablename);
    expect(tables).toEqual(expect.arrayContaining(["avatars", "users", "sessions", "login_tokens", "rate_limits"]));
  });

  // Carrying an old database over only applies to the embedded Postgres.
  it.skipIf(!!process.env.TEST_DATABASE_URL)("carries a database from before Postgres over into a new embedded one", async () => {
    await freshDatabase("pg-legacy");
    mkdirSync(process.env.DATA_DIR!, { recursive: true });
    const old = new DatabaseSync(path.join(process.env.DATA_DIR!, "app.db"));
    old.exec(`
      CREATE TABLE avatars (id TEXT PRIMARY KEY, slug TEXT UNIQUE, published INTEGER NOT NULL DEFAULT 0, edit_token_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL, owner_id TEXT);
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, data TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    `);
    const record = { id: "old1", slug: "sam", published: true, createdAt: 1, updatedAt: 2, consent: true, appearance: {}, concepts: [], persona: { name: "Sam", knowledge: "Runs." } };
    old.prepare("INSERT INTO avatars VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("old1", "sam", 1, "ab".repeat(32), 1, 2, JSON.stringify(record), "u_1");
    old.prepare("INSERT INTO users VALUES (?, ?, ?, ?)").run("u_1", "sam@example.com", 1, JSON.stringify({ comp: "pro" }));
    old.close();

    vi.resetModules();
    (globalThis as { __iidentPg?: unknown }).__iidentPg = undefined;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const db = await import("../db");
    const sam = (await db.getAvatarBySlug("sam"))!;
    expect(sam).toMatchObject({ id: "old1", published: true, persona: { name: "Sam" }, context: { knowledge: "Runs." } });
    expect(await db.avatarOwner("old1")).toBe("u_1");
    const billing = await import("../billing");
    expect(await billing.accountOf("u_1")).toEqual({ comp: "pro" });
    info.mockRestore();
  });
});
