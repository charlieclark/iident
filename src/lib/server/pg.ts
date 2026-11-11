import "server-only";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config";
import { MIGRATIONS } from "./schema";

/**
 * The Postgres connection.
 *
 * With DATABASE_URL set (any Postgres: Neon through Vercel, Supabase, your
 * own) queries go through a small connection pool. Without it, an embedded
 * Postgres (PGlite) keeps its files under DATA_DIR/pg, so local development
 * and the tests need no database server. On Vercel a database is required.
 *
 * The schema is brought up to date on first use (see ./schema.ts).
 */

export type Queryable = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type Database = Queryable & {
  /**
   * Runs `fn` in a transaction. Inside it, query only through `tx`: the
   * embedded database has a single connection, which the transaction holds.
   */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Whether this is the embedded database rather than a server. */
  embedded: boolean;
};

const databaseUrl = () => process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || undefined;

async function connectServer(url: string): Promise<Database> {
  const { Pool } = await import("pg");
  // A serverless instance handles few requests at once, and every instance holds its own pool.
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 10_000 });
  // An idle connection dropped by the server must not take the process down.
  pool.on("error", (err) => console.warn("[db] idle connection error:", err.message));
  if (process.env.VERCEL) {
    // Lets Vercel close idle connections before it suspends the instance.
    const { attachDatabasePool } = await import("@vercel/functions");
    attachDatabasePool(pool);
  }
  return {
    embedded: false,
    query: async <T>(text: string, params?: unknown[]) => (await pool.query(text, params)).rows as T[],
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: async <T>(text: string, params?: unknown[]) => (await client.query(text, params)).rows as T[] });
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

type Lite = {
  waitReady: Promise<void>;
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  transaction<T>(fn: (tx: { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> }) => Promise<T>): Promise<T>;
};

async function connectEmbedded(): Promise<Database> {
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Connect a Postgres database to the project (see docs/deploying.md).");
  }
  // Loaded by name at run time so the deployed app doesn't carry a database engine it never uses.
  const name = "@electric-sql/pglite";
  let PGlite: new (dataDir?: string) => Lite;
  try {
    ({ PGlite } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ name)) as { PGlite: new (dataDir?: string) => Lite });
  } catch {
    throw new Error("No database: set DATABASE_URL to a Postgres connection string, or install dev dependencies for the embedded one.");
  }
  mkdirSync(config.dataDir, { recursive: true });
  const lite = new PGlite(path.join(config.dataDir, "pg"));
  await lite.waitReady;
  return {
    embedded: true,
    query: async <T>(text: string, params?: unknown[]) => (await lite.query(text, params)).rows as T[],
    transaction: (fn) => lite.transaction((tx) => fn({ query: async <T>(text: string, params?: unknown[]) => (await tx.query(text, params)).rows as T[] })),
  };
}

export const errorCode = (err: unknown) => (err as { code?: string } | null)?.code;
/** Postgres error codes the app handles. */
export const UNDEFINED_TABLE = "42P01";
export const UNIQUE_VIOLATION = "23505";

/** Applies the migrations that haven't run yet. Returns whether the schema was created from nothing. */
async function migrate(conn: Database): Promise<boolean> {
  let version = 0;
  try {
    version = Number((await conn.query<{ v: number }>("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations"))[0].v);
  } catch (err) {
    if (errorCode(err) !== UNDEFINED_TABLE) throw err;
  }
  if (version >= MIGRATIONS.length) return false;
  return conn.transaction(async (tx) => {
    // Several instances can start at once; only one of them migrates.
    await tx.query("SELECT pg_advisory_xact_lock(47110815)");
    await tx.query("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)");
    const from = Number((await tx.query<{ v: number }>("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations"))[0].v);
    for (let i = from; i < MIGRATIONS.length; i++) {
      for (const statement of MIGRATIONS[i]) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)", [i + 1, Date.now()]);
    }
    return from === 0;
  });
}

async function open(): Promise<Database> {
  const url = databaseUrl();
  const conn = url ? await connectServer(url) : await connectEmbedded();
  const created = await migrate(conn);
  // A database from before the move to Postgres is carried over once, into the embedded database only.
  const legacy = path.join(config.dataDir, "app.db");
  if (created && conn.embedded && existsSync(legacy)) {
    const { importSqlite } = await import("./legacySqlite");
    await importSqlite(conn, legacy);
  }
  return conn;
}

// Kept on globalThis so development hot reloads reuse the connection.
const g = globalThis as unknown as { __iidentPg?: Promise<Database> };

export function database(): Promise<Database> {
  if (!g.__iidentPg) {
    const opening = open();
    g.__iidentPg = opening;
    // A failed start (database unreachable) is retried by the next request.
    opening.catch(() => {
      if (g.__iidentPg === opening) g.__iidentPg = undefined;
    });
  }
  return g.__iidentPg;
}

export async function query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  return (await database()).query<T>(text, params);
}

export async function one<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

export async function transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return (await database()).transaction(fn);
}
