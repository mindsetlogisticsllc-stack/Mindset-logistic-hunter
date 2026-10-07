"use strict";

const { Pool } = require("pg");
const { DATABASE_URL } = require("./config");

let pool = null;
let ready = false;
let lastError = "";

// Railway's private network (*.railway.internal) has no SSL; its public
// proxy URL may require it. Start with the likely setting and flip once
// if Postgres says otherwise.
let useSsl =
  process.env.NODE_ENV === "production" &&
  !/\.railway\.internal|localhost|127\.0\.0\.1/.test(DATABASE_URL);

function createPool() {
  const next = new Pool({
    connectionString: DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  next.on("error", (err) => {
    console.error("PostgreSQL pool error:", err.message);
  });

  return next;
}

if (DATABASE_URL) {
  pool = createPool();
}

function query(text, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured");
  }

  return pool.query(text, params);
}

async function withClient(fn) {
  const client = await pool.connect();

  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'none',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT UNIQUE,
    current_period_end TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL DEFAULT '',
    alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    unsubscribe_token TEXT UNIQUE NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- One row per check a customer runs. snapshot is exactly what was seen
  -- and record_hash (sha256 of the canonical record) proves it wasn't
  -- edited later, so the broker can show their due diligence.
  CREATE TABLE IF NOT EXISTS vettings (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dot_number TEXT NOT NULL,
    legal_name TEXT NOT NULL DEFAULT '',
    decision TEXT NOT NULL,
    score INTEGER NOT NULL,
    flags JSONB NOT NULL DEFAULT '[]',
    snapshot JSONB NOT NULL,
    load_reference TEXT NOT NULL DEFAULT '',
    checked_by TEXT NOT NULL DEFAULT '',
    record_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_vettings_user ON vettings(user_id, created_at DESC);

  -- Carriers a customer wants watched every day.
  CREATE TABLE IF NOT EXISTS watchlist (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dot_number TEXT NOT NULL,
    legal_name TEXT NOT NULL DEFAULT '',
    last_snapshot JSONB,
    last_checked_at TIMESTAMPTZ,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, dot_number)
  );

  CREATE TABLE IF NOT EXISTS watch_changes (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dot_number TEXT NOT NULL,
    changes JSONB NOT NULL,
    emailed BOOLEAN NOT NULL DEFAULT FALSE,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS job_runs (
    job TEXT NOT NULL,
    run_date DATE NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    PRIMARY KEY (job, run_date)
  );
`;

async function initialize() {
  if (!pool) {
    lastError = "DATABASE_URL is not configured";
    console.warn(lastError);
    return false;
  }

  try {
    try {
      await query("SELECT 1");
    } catch (err) {
      const message = String(err.message || "");
      const mismatch =
        (useSsl && /does not support SSL/i.test(message)) ||
        (!useSsl && /SSL.*required|requires SSL|no encryption/i.test(message));

      if (!mismatch) {
        throw err;
      }

      useSsl = !useSsl;
      console.warn(`PostgreSQL SSL mismatch; reconnecting with SSL ${useSsl ? "on" : "off"}.`);
      const old = pool;
      pool = createPool();
      old.end().catch(() => {});
      await query("SELECT 1");
    }

    await query(SCHEMA);

    ready = true;
    lastError = "";
    console.log("Database ready.");
    return true;
  } catch (err) {
    ready = false;
    lastError = err.message;
    console.error("Database initialization failed:", err.message);
    return false;
  }
}

module.exports = {
  query,
  withClient,
  initialize,
  isReady: () => ready,
  lastError: () => lastError,
  hasPool: () => Boolean(pool)
};
