"use strict";

const crypto = require("crypto");
const express = require("express");

const config = require("./src/config");
const db = require("./src/db");
const auth = require("./src/auth");
const billing = require("./src/billing");
const fmcsa = require("./src/fmcsa");
const monitor = require("./src/monitor");
const views = require("./src/views");
const { evaluate } = require("./src/vet");
const { hashRecord, verifyRecord } = require("./src/record");
const { emailConfigured } = require("./src/email");

process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err));

const app = express();
app.set("trust proxy", 1);

function baseUrl(req) {
  return config.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/*
  Stripe signs the exact request bytes, so the webhook reads the raw body
  and is registered before the form parser.
*/
app.post(
  "/stripe/webhook",
  express.raw({ type: "*/*", limit: "1mb" }),
  wrap(async (req, res) => {
    if (!config.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).send("Stripe webhook is not configured.");
    }

    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";

    if (!billing.verifySignature(raw, req.headers["stripe-signature"], config.STRIPE_WEBHOOK_SECRET)) {
      return res.status(400).send("Invalid Stripe signature.");
    }

    await billing.handleEvent(JSON.parse(raw));
    res.json({ received: true });
  })
);

app.use(express.urlencoded({ extended: true, limit: "100kb" }));

async function attachUser(req, res, next) {
  try {
    req.user = await auth.currentUser(req);
  } catch (err) {
    console.error("Session lookup failed:", err.message);
    req.user = null;
  }

  next();
}

function requireDb(req, res, next) {
  if (!db.isReady()) {
    return res
      .status(503)
      .send(views.simple("Temporarily unavailable", "<p>We're having a database problem. Please try again in a few minutes.</p>"));
  }

  next();
}

/* ---------------- public pages ---------------- */

app.get("/", attachUser, (req, res) => res.send(views.landing({ user: req.user })));
app.get("/terms", (req, res) => res.send(views.terms()));
app.get("/privacy", (req, res) => res.send(views.privacy()));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: config.APP_NAME,
    database: db.isReady(),
    ...(db.isReady() ? {} : { database_error: db.lastError() || "starting" }),
    fmcsa_configured: fmcsa.configured(),
    email_configured: emailConfigured(),
    billing_configured: billing.billingConfigured(),
    webhook_secret_configured: Boolean(config.STRIPE_WEBHOOK_SECRET),
    webhook_secret_ends_with: config.STRIPE_WEBHOOK_SECRET ? config.STRIPE_WEBHOOK_SECRET.slice(-4) : null,
    stripe_key_mode: config.STRIPE_SECRET_KEY.startsWith("sk_live_")
      ? "live"
      : config.STRIPE_SECRET_KEY.startsWith("sk_test_")
        ? "test"
        : config.STRIPE_SECRET_KEY
          ? "unrecognized"
          : null,
    public_url_configured: Boolean(config.PUBLIC_URL)
  });
});

/* ---------------- accounts ---------------- */

app.get("/signup", attachUser, (req, res) => (req.user ? res.redirect("/dashboard") : res.send(views.authForm({ mode: "signup" }))));

app.post(
  "/signup",
  requireDb,
  wrap(async (req, res) => {
    const email = auth.normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const fail = (error) => res.status(400).send(views.authForm({ mode: "signup", error, email }));

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail("Please enter a valid email address.");
    }

    if (password.length < 8) {
      return fail("Password must be at least 8 characters.");
    }

    if (password !== String(req.body.password_confirm || "")) {
      return fail("Passwords don't match.");
    }

    const created = await db.withClient(async (client) => {
      await client.query("BEGIN");

      try {
        const existing = await client.query(`SELECT 1 FROM users WHERE email=$1`, [email]);

        if (existing.rows.length) {
          await client.query("ROLLBACK");
          return false;
        }

        const userId = crypto.randomUUID();

        await client.query(`INSERT INTO users (id, email, password_hash) VALUES ($1,$2,$3)`, [userId, email, auth.hashPassword(password)]);
        await client.query(`INSERT INTO profiles (user_id, unsubscribe_token) VALUES ($1,$2)`, [
          userId,
          crypto.randomBytes(24).toString("hex")
        ]);
        await client.query(`INSERT INTO subscriptions (user_id, status) VALUES ($1,'none')`, [userId]);
        await auth.createSession(res, req, userId, client);
        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });

    if (!created) {
      return fail("An account with that email already exists. Try logging in.");
    }

    res.redirect("/dashboard");
  })
);

app.get("/login", attachUser, (req, res) => (req.user ? res.redirect("/dashboard") : res.send(views.authForm({ mode: "login" }))));

app.post(
  "/login",
  requireDb,
  wrap(async (req, res) => {
    const email = auth.normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const keys = [`ip:${req.ip}`, `email:${email}`];

    if (auth.loginBlocked(keys)) {
      return res
        .status(429)
        .send(views.authForm({ mode: "login", email, error: "Too many failed attempts. Please wait 15 minutes." }));
    }

    const result = await db.query(`SELECT id, password_hash FROM users WHERE email=$1`, [email]);
    const user = result.rows[0];

    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      auth.recordLoginFailure(keys);
      return res.status(401).send(views.authForm({ mode: "login", email, error: "Wrong email or password." }));
    }

    auth.clearLoginFailures(keys);
    await auth.createSession(res, req, user.id);
    res.redirect("/dashboard");
  })
);

app.post(
  "/logout",
  wrap(async (req, res) => {
    await auth.destroySession(req, res);
    res.redirect("/");
  })
);

/* ---------------- dashboard & checks ---------------- */

async function monthlyUsage(userId, now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const result = await db.query(`SELECT COUNT(*)::int AS n FROM vettings WHERE user_id=$1 AND created_at >= $2`, [userId, monthStart]);
  return { used: result.rows[0].n };
}

async function renderDashboard(req, res, { error = "", q = "", status = 200 } = {}) {
  const subscription = await billing.getSubscription(req.user.id);
  const access = billing.hasAccess(subscription);

  const [usage, vettings, watchlist] = await Promise.all([
    monthlyUsage(req.user.id),
    db.query(
      `SELECT id, dot_number, legal_name, decision, load_reference, created_at FROM vettings
       WHERE user_id=$1 ORDER BY created_at DESC LIMIT 25`,
      [req.user.id]
    ),
    db.query(`SELECT dot_number, legal_name, last_checked_at FROM watchlist WHERE user_id=$1 ORDER BY added_at DESC`, [req.user.id])
  ]);

  const flash = req.query.welcome
    ? "You're subscribed. Unlimited checks and daily monitoring are on."
    : req.query.watching
      ? "Added to your watchlist. We'll email you if anything changes."
      : "";

  res.status(status).send(
    views.dashboard({
      user: req.user,
      access,
      subscription,
      usage,
      vettings: vettings.rows,
      watchlist: watchlist.rows,
      flash,
      error,
      q: q || String(req.query.q || ""),
      billingReady: billing.billingConfigured(),
      fmcsaReady: fmcsa.configured()
    })
  );
}

app.get(
  "/dashboard",
  requireDb,
  attachUser,
  auth.requireUser,
  wrap(async (req, res) => {
    if (req.query.session_id) {
      try {
        await billing.confirmCheckoutSession(req.user, req.query.session_id);
      } catch (err) {
        console.error("Checkout confirmation failed:", err.message);
      }
    }

    await renderDashboard(req, res);
  })
);

// Links in alert emails ("Re-check this carrier") land here.
app.get("/check", (req, res) => res.redirect(`/dashboard?q=${encodeURIComponent(String(req.query.q || ""))}`));

app.post(
  "/check",
  requireDb,
  attachUser,
  auth.requireUser,
  wrap(async (req, res) => {
    const q = String(req.body.q || "").trim();
    const identifier = fmcsa.parseIdentifier(q);

    if (!identifier) {
      return renderDashboard(req, res, { error: "Enter an MC number (e.g. MC-123456) or a USDOT number.", q, status: 400 });
    }

    if (!fmcsa.configured()) {
      return renderDashboard(req, res, { error: "Carrier lookups aren't switched on yet. Please try again soon.", q, status: 503 });
    }

    const subscription = await billing.getSubscription(req.user.id);

    if (!billing.hasAccess(subscription)) {
      const { used } = await monthlyUsage(req.user.id);

      if (used >= config.FREE_LOOKUPS_PER_MONTH) {
        return renderDashboard(req, res, {
          error: `You've used your ${config.FREE_LOOKUPS_PER_MONTH} free checks this month. Upgrade for unlimited checks.`,
          q,
          status: 402
        });
      }
    }

    let snapshot;

    try {
      snapshot = await fmcsa.lookup(identifier);
    } catch (err) {
      console.error("FMCSA lookup failed:", err.message);
      return renderDashboard(req, res, { error: "FMCSA didn't respond. Please try again in a minute.", q, status: 502 });
    }

    if (!snapshot) {
      return renderDashboard(req, res, { error: `No carrier found for “${q}”. Check the number and try again.`, q, status: 404 });
    }

    // Hash exactly what Postgres will hand back (JSON round-trip drops
    // undefined values), so the record verifies when read later.
    snapshot = JSON.parse(JSON.stringify(snapshot));
    const result = JSON.parse(JSON.stringify(evaluate(snapshot)));

    const row = {
      id: crypto.randomUUID(),
      user_id: req.user.id,
      dot_number: snapshot.dot_number,
      legal_name: snapshot.legal_name,
      decision: result.decision,
      score: result.score,
      flags: result.flags,
      snapshot,
      load_reference: String(req.body.load || "").trim().slice(0, 80),
      checked_by: req.user.email,
      // Millisecond precision only, so the stored value round-trips exactly.
      created_at: new Date()
    };

    row.record_hash = hashRecord(row);

    await db.query(
      `INSERT INTO vettings (id, user_id, dot_number, legal_name, decision, score, flags, snapshot, load_reference, checked_by, record_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        row.id,
        row.user_id,
        row.dot_number,
        row.legal_name,
        row.decision,
        row.score,
        JSON.stringify(row.flags),
        JSON.stringify(row.snapshot),
        row.load_reference,
        row.checked_by,
        row.record_hash,
        row.created_at
      ]
    );

    res.redirect(`/records/${row.id}`);
  })
);

async function loadRecord(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) {
    return null;
  }

  const result = await db.query(`SELECT * FROM vettings WHERE id=$1`, [id]);
  return result.rows[0] || null;
}

app.get(
  "/records/:id",
  requireDb,
  attachUser,
  auth.requireUser,
  wrap(async (req, res) => {
    const record = await loadRecord(req.params.id);

    if (!record || record.user_id !== req.user.id) {
      return res.status(404).send(views.simple("Record not found", `<p><a href="/dashboard">Back to dashboard</a></p>`, { user: req.user }));
    }

    res.send(views.recordPage({ user: req.user, record, valid: verifyRecord(record), owner: true }));
  })
);

// Public integrity check: shows only the decision, carrier and fingerprint
// status, so a broker can send the link to an insurer or attorney.
app.get(
  "/verify/:id",
  requireDb,
  wrap(async (req, res) => {
    const record = await loadRecord(req.params.id);

    if (!record) {
      return res.status(404).send(views.simple("Record not found", "<p>No vetting record has this ID.</p>"));
    }

    const valid = verifyRecord(record);
    const decision = views.DECISION[record.decision] || {};

    res.send(
      views.simple(
        "Record verification",
        `<p>${valid ? "✅ <strong>Authentic.</strong> This record matches its fingerprint and has not been altered." : "❌ <strong>Not verified.</strong> This record does not match its fingerprint."}</p>
         <p>Carrier: <strong>${escape(record.legal_name)}</strong> (USDOT ${escape(record.dot_number)})<br>
         Checked: ${escape(new Date(record.created_at).toUTCString())}<br>
         Decision: ${escape(`${decision.icon || ""} ${decision.label || record.decision}`)}</p>
         <p class="meta mono">SHA-256: ${escape(record.record_hash)}</p>`
      )
    );
  })
);

function escape(value) {
  return require("./src/html").escapeHtml(value);
}

/* ---------------- watchlist ---------------- */

app.post(
  "/watch/:dot",
  requireDb,
  attachUser,
  auth.requireUser,
  wrap(async (req, res) => {
    const dot = String(req.params.dot).replace(/\D/g, "");
    const subscription = await billing.getSubscription(req.user.id);

    if (!billing.hasAccess(subscription)) {
      return renderDashboard(req, res, { error: "Daily monitoring is included with a subscription. Upgrade to watch carriers.", status: 402 });
    }

    // Seed from this user's latest check so tomorrow's run has a baseline.
    const latest = await db.query(
      `SELECT legal_name, snapshot FROM vettings WHERE user_id=$1 AND dot_number=$2 ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, dot]
    );

    if (!latest.rows.length) {
      return renderDashboard(req, res, { error: "Check the carrier first, then add it to your watchlist.", status: 400 });
    }

    await db.query(
      `INSERT INTO watchlist (user_id, dot_number, legal_name, last_snapshot, last_checked_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (user_id, dot_number) DO NOTHING`,
      [req.user.id, dot, latest.rows[0].legal_name, JSON.stringify(latest.rows[0].snapshot)]
    );

    res.redirect("/dashboard?watching=1");
  })
);

app.post(
  "/watch/:dot/remove",
  requireDb,
  attachUser,
  auth.requireUser,
  wrap(async (req, res) => {
    await db.query(`DELETE FROM watchlist WHERE user_id=$1 AND dot_number=$2`, [req.user.id, String(req.params.dot).replace(/\D/g, "")]);
    res.redirect("/dashboard");
  })
);

/* ---------------- billing ---------------- */

app.post(
  "/billing/checkout",
  requireDb,
  attachUser,
  auth.requireUser,
  wrap(async (req, res) => {
    if (!billing.billingConfigured()) {
      return res.redirect("/dashboard");
    }

    const subscription = await billing.getSubscription(req.user.id);

    if (billing.hasAccess(subscription)) {
      return res.redirect("/billing/portal");
    }

    res.redirect(303, await billing.checkoutUrl(req.user, baseUrl(req)));
  })
);

app.get(
  "/billing/portal",
  requireDb,
  attachUser,
  auth.requireUser,
  wrap(async (req, res) => {
    if (!billing.billingConfigured()) {
      return res.redirect("/dashboard");
    }

    const url = await billing.portalUrl(req.user, baseUrl(req));
    res.redirect(url || "/dashboard");
  })
);

/* ---------------- unsubscribe ---------------- */

async function profileByToken(token) {
  const result = await db.query(`SELECT user_id FROM profiles WHERE unsubscribe_token=$1`, [String(token)]);
  return result.rows[0] || null;
}

// GET only shows a button: mail scanners follow links, and that must not
// unsubscribe anyone. The POST also serves Gmail's one-click unsubscribe.
app.get(
  "/unsubscribe/:token",
  requireDb,
  wrap(async (req, res) => {
    if (!(await profileByToken(req.params.token))) {
      return res.status(404).send(views.simple("Link not found", "<p>This unsubscribe link isn't valid.</p>"));
    }

    res.send(
      views.simple(
        "Unsubscribe",
        `<p>Stop receiving carrier change alerts?</p><form method="POST"><button class="btn">Unsubscribe</button></form>`
      )
    );
  })
);

app.post(
  "/unsubscribe/:token",
  requireDb,
  wrap(async (req, res) => {
    const profile = await profileByToken(req.params.token);

    if (profile) {
      await db.query(`UPDATE profiles SET alerts_enabled=FALSE, updated_at=NOW() WHERE user_id=$1`, [profile.user_id]);
    }

    res.send(
      views.simple(
        "You're unsubscribed",
        `<p>You won't get more change alerts. This doesn't cancel a paid subscription; use Manage billing on your dashboard for that.</p>`
      )
    );
  })
);

/* ---------------- admin ---------------- */

function adminTokenValid(token) {
  if (!config.ADMIN_TOKEN || !token) {
    return false;
  }

  const a = Buffer.from(String(token));
  const b = Buffer.from(config.ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post(
  "/admin/monitor",
  requireDb,
  wrap(async (req, res) => {
    if (!adminTokenValid(req.query.token)) {
      return res.status(403).json({ error: "forbidden" });
    }

    res.json(await monitor.runMonitor({ force: true }));
  })
);

/* ---------------- errors ---------------- */

app.use((req, res) => res.status(404).send(views.simple("Page not found", `<p><a href="/">Go home</a></p>`)));

app.use((err, req, res, next) => {
  console.error("Request error:", err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).send(views.simple("Something went wrong", "<p>Please try again in a moment.</p>"));
});

/* ---------------- start ---------------- */

async function start() {
  await db.initialize();

  const server = app.listen(config.PORT, "0.0.0.0", () => {
    console.log(`${config.APP_NAME} listening on ${config.PORT}. Database ready: ${db.isReady()}`);
  });

  const retry = setInterval(() => {
    if (!db.isReady() && db.hasPool()) {
      db.initialize();
    }
  }, 60000);

  const scheduler = monitor.startScheduler();

  const shutdown = () => {
    clearInterval(retry);
    clearInterval(scheduler);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) {
  start();
}

module.exports = { app };
