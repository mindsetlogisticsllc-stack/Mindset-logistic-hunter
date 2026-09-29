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

  CREATE TABLE IF NOT EXISTS profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL DEFAULT '',
    naics_codes TEXT[] NOT NULL DEFAULT '{}',
    keywords TEXT[] NOT NULL DEFAULT '{}',
    states TEXT[] NOT NULL DEFAULT '{}',
    certifications TEXT[] NOT NULL DEFAULT '{}',
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    unsubscribe_token TEXT UNIQUE NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'none',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT UNIQUE,
    current_period_end TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS opportunities (
    notice_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    solicitation_number TEXT,
    agency TEXT,
    naics_code TEXT,
    psc_code TEXT,
    notice_type TEXT,
    set_aside_code TEXT,
    set_aside TEXT,
    posted_date DATE,
    response_deadline TIMESTAMPTZ,
    state TEXT,
    city TEXT,
    ui_link TEXT,
    raw JSONB,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_opportunities_posted
    ON opportunities(posted_date);

  CREATE TABLE IF NOT EXISTS sent_alerts (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notice_id TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, notice_id)
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
