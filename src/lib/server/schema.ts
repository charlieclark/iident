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
    // What visitors report about a published avatar, for the owner of the site to act on.
    `CREATE TABLE reports (
      id TEXT PRIMARY KEY,
      avatar_id TEXT NOT NULL,
      slug TEXT,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      reporter_email TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at BIGINT NOT NULL,
      resolved_at BIGINT
    )`,
    `CREATE INDEX reports_status ON reports (status, created_at)`,
    // What people do, one row per step (signed up, uploaded a selfie, built, published...). Kept here, sent nowhere.
    `CREATE TABLE events (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT,
      avatar_id TEXT,
      at BIGINT NOT NULL,
      props JSONB NOT NULL DEFAULT '{}'
    )`,
    `CREATE INDEX events_name_at ON events (name, at)`,
    // What went wrong, on the server and in people's browsers.
    `CREATE TABLE errors (
      id BIGSERIAL PRIMARY KEY,
      at BIGINT NOT NULL,
      source TEXT NOT NULL,
      route TEXT,
      message TEXT NOT NULL,
      detail TEXT
    )`,
    `CREATE INDEX errors_at ON errors (at)`,
  ],
  [
    // When the account was last used, and when its owner was told it would be deleted for being unused
    // (see ./retention.ts). Accounts from before this start counting from the day they were created.
    `ALTER TABLE users ADD COLUMN last_seen_at BIGINT`,
    `ALTER TABLE users ADD COLUMN retention_warned_at BIGINT`,
    `UPDATE users SET last_seen_at = GREATEST(created_at, COALESCE((SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = users.id), 0))`,
    `CREATE INDEX users_last_seen ON users (last_seen_at)`,
    // Where the image service currently holds a copy of one of our stored files, and until when (see ./falLinks.ts).
    `CREATE TABLE fal_links (
      file TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )`,
  ],
];
