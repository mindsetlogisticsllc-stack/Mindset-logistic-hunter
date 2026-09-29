"use strict";

const crypto = require("crypto");
const express = require("express");

const config = require("./src/config");
const db = require("./src/db");
const auth = require("./src/auth");
const billing = require("./src/billing");
const jobs = require("./src/jobs");
const views = require("./src/views");
const {
  rankMatches,
  parseNaics,
  parseKeywords,
  parseStates,
  parseCertifications
} = require("./src/match");

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
  and is registered before the form/JSON parsers.
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
    sam_configured: Boolean(config.SAM_API_KEY),
    email_configured: Boolean(config.RESEND_API_KEY && config.EMAIL_FROM),
    billing_configured: billing.billingConfigured(),
    public_url_configured: Boolean(config.PUBLIC_URL)
  });
});

/* ---------------- accounts ---------------- */

app.get("/signup", attachUser, (req, res) => {
  if (req.user) {
    return res.redirect("/dashboard");
  }

  res.send(views.authForm({ mode: "signup" }));
});

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

        await client.query(`INSERT INTO users (id, email, password_hash) VALUES ($1,$2,$3)`, [
          userId,
          email,
          auth.hashPassword(password)
        ]);
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

app.get("/login", attachUser, (req, res) => {
  if (req.user) {
    return res.redirect("/dashboard");
  }

  res.send(views.authForm({ mode: "login" }));
});

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

/* ---------------- dashboard ---------------- */

async function loadProfile(userId) {
  const result = await db.query(`SELECT * FROM profiles WHERE user_id=$1`, [userId]);

  if (result.rows[0]) {
    return result.rows[0];
  }

  const created = await db.query(
    `INSERT INTO profiles (user_id, unsubscribe_token) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING *`,
    [userId, crypto.randomBytes(24).toString("hex")]
  );

  return created.rows[0];
}

app.get(
  "/dashboard",
  requireDb,
  auth.requireUser,
  wrap(async (req, res) => {
    const profile = await loadProfile(req.user.id);
    const subscription = await billing.getSubscription(req.user.id);
    const access = billing.hasAccess(subscription);
    const recent = await jobs.recentOpportunities(7);
    const matches = rankMatches(recent, profile, 50);

    const flash =
      req.query.welcome
        ? `You're in! Your first alert email arrives tomorrow morning.`
        : req.query.saved
          ? "Saved. Your matches below are updated."
          : "";

    res.send(
      views.dashboard({
        user: req.user,
        profile,
        subscription,
        access,
        matches,
        flash,
        billingReady: billing.billingConfigured()
      })
    );
  })
);

app.post(
  "/profile",
  requireDb,
  auth.requireUser,
  wrap(async (req, res) => {
    await loadProfile(req.user.id);

    await db.query(
      `UPDATE profiles SET
         company_name=$2, naics_codes=$3, keywords=$4, states=$5, certifications=$6,
         email_enabled=$7, updated_at=NOW()
       WHERE user_id=$1`,
      [
        req.user.id,
        String(req.body.company_name || "").trim().slice(0, 200),
        parseNaics(req.body.naics_codes),
        parseKeywords(req.body.keywords),
        parseStates(req.body.states),
        parseCertifications(req.body.certifications),
        req.body.email_enabled === "1"
      ]
    );

    res.redirect("/dashboard?saved=1");
  })
);

/* ---------------- billing ---------------- */

app.post(
  "/billing/checkout",
  requireDb,
  auth.requireUser,
  wrap(async (req, res) => {
    if (!billing.billingConfigured()) {
      return res.redirect("/dashboard");
    }

    const subscription = await billing.getSubscription(req.user.id);

    // Already subscribed: never open a second subscription.
    if (billing.hasAccess(subscription)) {
      return res.redirect("/billing/portal");
    }

    res.redirect(303, await billing.checkoutUrl(req.user, baseUrl(req)));
  })
);

app.get(
  "/billing/portal",
  requireDb,
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
        `<p>Stop receiving ${config.APP_NAME} alert emails?</p>
         <form method="POST"><button class="btn">Unsubscribe</button></form>`
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
      await db.query(`UPDATE profiles SET email_enabled=FALSE, updated_at=NOW() WHERE user_id=$1`, [profile.user_id]);
    }

    res.send(
      views.simple(
        "You're unsubscribed",
        `<p>You won't get any more alert emails. Changed your mind? Turn them back on from your <a href="/dashboard">dashboard</a>.</p>
         <p class="meta">This doesn't cancel a paid subscription. To stop billing, use Manage billing on your dashboard.</p>`
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

// Run today's download + emails now instead of waiting for the schedule.
app.post(
  "/admin/run",
  requireDb,
  wrap(async (req, res) => {
    if (!adminTokenValid(req.query.token)) {
      return res.status(403).json({ error: "forbidden" });
    }

    res.json(await jobs.runDaily({ force: true }));
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

  const scheduler = jobs.startScheduler();

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
