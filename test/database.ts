import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Gives a test file its own empty database and data folder. Call it in
 * `beforeAll`, before importing anything from `src/lib/server`.
 *
 * By default that is the embedded Postgres, in a temporary folder. With
 * TEST_DATABASE_URL set (a Postgres server the tests may create databases
 * on) each file gets a fresh database there instead, which exercises the
 * same driver as production:
 *
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
 */
export async function freshDatabase(name: string): Promise<void> {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), `iident-${name}-`));
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  const server = process.env.TEST_DATABASE_URL;
  if (!server) return;
  const database = `iident_test_${name.replace(/\W/g, "_")}_${randomBytes(4).toString("hex")}`;
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: server });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();
  const url = new URL(server);
  url.pathname = `/${database}`;
  process.env.DATABASE_URL = url.toString();
}
