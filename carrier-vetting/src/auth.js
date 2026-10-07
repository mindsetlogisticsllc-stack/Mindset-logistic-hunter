"use strict";

const crypto = require("crypto");
const db = require("./db");

const SESSION_DAYS = 30;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(":");

    if (!salt || !hash) {
      return false;
    }

    const derived = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), derived);
  } catch {
    return false;
  }
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(req) {
  const cookies = {};

  String(req.headers.cookie || "")
    .split(";")
    .forEach((part) => {
      const index = part.indexOf("=");

      if (index === -1) {
        return;
      }

      const key = part.slice(0, index).trim();
      const raw = part.slice(index + 1).trim();

      try {
        cookies[key] = decodeURIComponent(raw);
      } catch {
        cookies[key] = raw;
      }
    });

  return cookies;
}

function cookieFlags(req) {
  return `HttpOnly; Path=/; SameSite=Lax${req.secure ? "; Secure" : ""}`;
}

async function createSession(res, req, userId, client = null) {
  const token = crypto.randomBytes(32).toString("hex");
  const run = client ? client.query.bind(client) : db.query;

  await run(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '${SESSION_DAYS} days')`,
    [crypto.randomUUID(), userId, hashToken(token)]
  );

  res.setHeader(
    "Set-Cookie",
    `cv_session=${token}; Max-Age=${SESSION_DAYS * 86400}; ${cookieFlags(req)}`
  );
}

async function destroySession(req, res) {
  const token = parseCookies(req).cv_session;

  if (token && db.isReady()) {
    await db.query(`DELETE FROM sessions WHERE token_hash=$1`, [hashToken(token)]);
  }

  res.setHeader("Set-Cookie", `cv_session=; Max-Age=0; ${cookieFlags(req)}`);
}

async function currentUser(req) {
  if (!db.isReady()) {
    return null;
  }

  const token = parseCookies(req).cv_session;

  if (!token) {
    return null;
  }

  const result = await db.query(
    `SELECT u.id, u.email
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()
     LIMIT 1`,
    [hashToken(token)]
  );

  return result.rows[0] || null;
}

function requireUser(req, res, next) {
  currentUser(req)
    .then((user) => {
      if (!user) {
        return res.redirect("/login");
      }

      req.user = user;
      next();
    })
    .catch((err) => {
      console.error("Auth error:", err.message);
      res.redirect("/login");
    });
}

/*
  In-memory limiter for failed logins: 10 per 15 minutes per IP and per
  email. Enough to stop password guessing on a single instance.
*/
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map();

function loginBlocked(keys) {
  const now = Date.now();

  return keys.some((key) => {
    const entry = failures.get(key);

    if (!entry || now - entry.first > WINDOW_MS) {
      failures.delete(key);
      return false;
    }

    return entry.count >= MAX_FAILURES;
  });
}

function recordLoginFailure(keys) {
  const now = Date.now();

  keys.forEach((key) => {
    const entry = failures.get(key);

    if (!entry || now - entry.first > WINDOW_MS) {
      failures.set(key, { first: now, count: 1 });
    } else {
      entry.count += 1;
    }
  });

  if (failures.size > 10000) {
    for (const [key, entry] of failures) {
      if (now - entry.first > WINDOW_MS) {
        failures.delete(key);
      }
    }
  }
}

function clearLoginFailures(keys) {
  keys.forEach((key) => failures.delete(key));
}

module.exports = {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  currentUser,
  requireUser,
  loginBlocked,
  recordLoginFailure,
  clearLoginFailures
};
