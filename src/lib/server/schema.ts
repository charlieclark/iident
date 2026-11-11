/**
 * The database schema, as a list of migrations. Each entry is applied once,
 * in order, and recorded in `schema_migrations`. To change the schema, add a
 * new entry at the end; never edit one that has shipped.
 *
 * Times are milliseconds since the epoch (BIGINT). Avatars and accounts keep
 * their details in a JSONB document, with the fields that are looked up or
 * must be unique as real columns.
 */
export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE avatars (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE,
      published BOOLEAN NOT NULL DEFAULT FALSE,
      owner_id TEXT,
      edit_token_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      data JSONB NOT NULL
    )`,
    `CREATE INDEX avatars_owner ON avatars (owner_id)`,
    `CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at BIGINT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'
    )`,
    `CREATE INDEX users_stripe_customer ON users ((data->>'stripeCustomerId'))`,
    `CREATE TABLE login_tokens (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    )`,
    `CREATE INDEX login_tokens_email ON login_tokens (email)`,
    `CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    )`,
    // Token buckets for rate limiting, shared by every server instance.
    `CREATE TABLE rate_limits (
      key TEXT PRIMARY KEY,
      tokens DOUBLE PRECISION NOT NULL,
      at BIGINT NOT NULL
    )`,
  ],
  [
    // Outfits drawn on the mannequin. It is the same mannequin for everyone, so each look is drawn once and shared.
    `CREATE TABLE mannequin_sketches (
      key TEXT PRIMARY KEY,
      file TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )`,
  ],
];
