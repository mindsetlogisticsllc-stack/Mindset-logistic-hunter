const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");

/*
========================================================
PROCESS-LEVEL SAFETY NETS
========================================================
Without these, a single unhandled promise rejection or a
thrown error outside an Express handler (e.g. inside a
setInterval callback, or a race in the contract monitor)
takes the whole process down on Railway. Log and keep
running instead of crashing on things we can recover from.
========================================================
*/

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

const app = express();

const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";

app.set("trust proxy", 1);

/*
========================================================
REQUEST BODY MIDDLEWARE
========================================================
JSON parsing is installed before API routes. The verify hook
preserves the exact request bytes needed for Stripe webhook
signature verification.
========================================================
*/

app.use(
  express.json({
    limit: "2mb",
    verify: (req, res, buf) => {
      req.rawBody = Buffer.from(buf);
    }
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb"
  })
);

/*
========================================================
INTELIBID 5.3 — GOV/CON
========================================================

5.0 architecture preserved.

5.2 adds:
- Self-service plans
- Automatic paid-plan activation when Stripe is configured
- Contract tracking
- Expiration tracking
- Renewal tracking
- Renewal/expiration status
- Automatic monitoring
- Customer dashboard contract intelligence
- Activity history
- Plan-based feature limits
- Existing 8-stage pipeline
- Hunter integration
- Company-specific intelligence
- Human approval before bid submission

No Contact Sales workflow.
========================================================
*/

const DATABASE_URL = process.env.DATABASE_URL || "";

const SERVICE_URLS = {
  hunter:
    process.env.HUNTER_API_URL ||
    "https://mindset-logistic-hunter-production.up.railway.app",

  eligibility:
    process.env.ELIGIBILITY_API_URL ||
    "https://eligibility-agent-production.up.railway.app",

  analyzer:
    process.env.ANALYZER_API_URL ||
    "https://mindset-contract-analyzer-production.up.railway.app",

  performer:
    process.env.PERFORMER_API_URL ||
    "https://mindset-opportunity-ai-production.up.railway.app",

  pricing:
    process.env.PRICING_API_URL ||
    "https://mindset-pricing-proposal-agent-production-9d62.up.railway.app",

  partner:
    process.env.PARTNER_API_URL ||
    "https://proposal-sales-package-agent-production.up.railway.app"
};

const SAM_API_KEY =
  process.env.SAM_API_KEY || process.env.SAM_GOV_API_KEY || "";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

const STRIPE_PRICE_IDS = {
  professional: process.env.STRIPE_PRICE_PROFESSIONAL || "",
  business: process.env.STRIPE_PRICE_BUSINESS || "",
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || ""
};

const PLANS = {
  free: {
    id: "free",
    name: "Free",
    monthly: 0,
    maxCompanies: 1,
    maxActiveSearches: 1,
    maxPipelineRuns: 5,
    maxOpportunities: 10,
    features: [
      "Basic opportunity discovery",
      "Basic opportunity facts",
      "Basic match indication",
      "Limited eligibility preview",
      "Company profile"
    ]
  },

  professional: {
    id: "professional",
    name: "Professional",
    monthly: 99,
    maxCompanies: 1,
    maxActiveSearches: 5,
    maxPipelineRuns: 50,
    maxOpportunities: 100,
    features: [
      "Opportunity intelligence",
      "Eligibility intelligence",
      "Contract analysis",
      "Performance intelligence",
      "Pricing & profitability",
      "Contract expiration tracking",
      "Renewal tracking"
    ]
  },

  business: {
    id: "business",
    name: "Business",
    monthly: 249,
    maxCompanies: 5,
    maxActiveSearches: 20,
    maxPipelineRuns: 250,
    maxOpportunities: 1000,
    features: [
      "Everything in Professional",
      "Advanced profitability",
      "Partner intelligence",
      "Bid package intelligence",
      "Advanced contract monitoring",
      "Renewal intelligence",
      "Higher usage limits"
    ]
  },

  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    monthly: 699,
    displayPrice: "$699+",
    maxCompanies: 25,
    maxActiveSearches: 100,
    maxPipelineRuns: 1000,
    maxOpportunities: 10000,
    features: [
      "Everything in Business",
      "Full automation",
      "Higher usage limits",
      "Multiple company profiles",
      "Enterprise contract intelligence",
      "Automated monitoring",
      "Automated renewal intelligence"
    ]
  }
};

const PIPELINE_STAGES = [
  {
    number: 1,
    name: "Company Profile",
    tagline: "Tell us who you are, once.",
    description:
      "Capabilities, NAICS codes, certifications, and past performance — captured once and reused by every stage below."
  },
  {
    number: 2,
    name: "Hunter",
    tagline: "Find opportunities that actually fit.",
    description:
      "Scans live federal solicitations and scores them against your company profile, not a generic keyword search."
  },
  {
    number: 3,
    name: "Eligibility",
    tagline: "Know before you spend a weekend on it.",
    description:
      "Checks set-aside status, size standards, and hard requirements before you invest proposal time."
  },
  {
    number: 4,
    name: "Contract Analyzer",
    tagline: "Read the fine print for you.",
    description:
      "Breaks the solicitation into requirements, deliverables, and evaluation criteria you can act on."
  },
  {
    number: 5,
    name: "Performance Analysis",
    tagline: "See if you can actually deliver it.",
    description:
      "Evaluates whether the scope matches your team's real capacity and track record."
  },
  {
    number: 6,
    name: "Pricing & Profitability",
    tagline: "Bid to win, not just to compete.",
    description:
      "Models pricing against historical awards so you're not guessing at what wins."
  },
  {
    number: 7,
    name: "Partner Intelligence",
    tagline: "Team up, don't sit it out.",
    description:
      "Sources real teaming and subcontracting candidates from SAM.gov and USASpending.gov when you need capabilities you don't have in-house."
  },
  {
    number: 8,
    name: "Bid Package",
    tagline: "Everything assembled, nothing auto-submitted.",
    description:
      "Compiles the proposal package for your review. A human on your team approves before anything goes out."
  }
];

let pool = null;
let databaseReady = false;

/*
========================================================
DATABASE
========================================================
*/

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  pool.on("error", (err) => {
    console.error("PostgreSQL pool error:", err.message);
  });
}

async function query(text, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured");
  }

  return pool.query(text, params);
}

async function initializeDatabase() {
  if (!pool) {
    console.warn("DATABASE_URL is not configured. Running in limited mode.");
    return false;
  }

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS companies (
        id UUID PRIMARY KEY,
        company_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        legal_name TEXT,
        website TEXT,
        description TEXT,
        address TEXT,
        city TEXT,
        state TEXT,
        zip TEXT,
        country TEXT DEFAULT 'USA',
        naics_codes TEXT,
        capabilities TEXT,
        certifications TEXT,
        government_experience TEXT,
        annual_revenue TEXT,
        employees TEXT,
        preferred_contract_size TEXT,
        target_agencies TEXT,
        target_states TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS company_memberships (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'owner',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, company_id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL DEFAULT 'free',
        status TEXT NOT NULL DEFAULT 'active',
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS opportunities (
        id UUID PRIMARY KEY,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        external_notice_id TEXT,
        title TEXT,
        agency TEXT,
        solicitation_number TEXT,
        naics_code TEXT,
        location TEXT,
        set_aside TEXT,
        response_deadline TIMESTAMPTZ,
        description TEXT,
        match_score NUMERIC,
        raw_data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(company_id, external_notice_id)
      );

      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id UUID PRIMARY KEY,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
        current_stage INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        eligibility JSONB,
        analyzer JSONB,
        performance JSONB,
        pricing JSONB,
        partner JSONB,
        bid_package JSONB,
        human_approval_status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pipeline_events (
        id UUID PRIMARY KEY,
        pipeline_run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        stage_number INTEGER NOT NULL,
        stage_name TEXT NOT NULL,
        status TEXT NOT NULL,
        request_payload JSONB,
        response_payload JSONB,
        evidence TEXT,
        error TEXT,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS contracts (
        id UUID PRIMARY KEY,
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
        contract_number TEXT,
        title TEXT NOT NULL,
        agency TEXT,
        contractor_name TEXT,
        start_date DATE,
        expiration_date DATE,
        renewal_date DATE,
        option_date DATE,
        auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
        renewal_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        contract_value NUMERIC,
        source TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS contract_events (
        id UUID PRIMARY KEY,
        contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        event_date DATE,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS teaming_candidates (
        id UUID PRIMARY KEY,
        pipeline_run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        entity_name TEXT,
        uei TEXT,
        naics_codes TEXT,
        set_aside_types TEXT,
        state TEXT,
        city TEXT,
        website TEXT,
        match_reason TEXT,
        award_amount NUMERIC,
        raw_data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_teaming_candidates_run
        ON teaming_candidates(pipeline_run_id);

      CREATE INDEX IF NOT EXISTS idx_opportunities_company
        ON opportunities(company_id);

      CREATE INDEX IF NOT EXISTS idx_pipeline_company
        ON pipeline_runs(company_id);

      CREATE INDEX IF NOT EXISTS idx_contract_company
        ON contracts(company_id);

      CREATE INDEX IF NOT EXISTS idx_contract_expiration
        ON contracts(expiration_date);

      CREATE INDEX IF NOT EXISTS idx_contract_renewal
        ON contracts(renewal_date);

      CREATE INDEX IF NOT EXISTS idx_sessions_token
        ON sessions(token_hash);
    `);

    databaseReady = true;
    console.log("InteliBid database initialized.");
    return true;
  } catch (err) {
    databaseReady = false;
    console.error("Database initialization failed:", err.message);
    console.error("Server will remain online in limited mode.");
    return false;
  }
}

/*
========================================================
HELPERS
========================================================
*/

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const derived = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");

  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(":");

    if (!salt || !hash) {
      return false;
    }

    const derived = crypto
      .scryptSync(password, salt, 64)
      .toString("hex");

    return crypto.timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(derived, "hex")
    );
  } catch {
    return false;
  }
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function parseCookies(req) {
  const cookies = {};

  const raw = req.headers.cookie || "";

  raw.split(";").forEach((part) => {
    const index = part.indexOf("=");

    if (index === -1) {
      return;
    }

    const key = part.slice(0, index).trim();
    const value = decodeURIComponent(part.slice(index + 1).trim());

    cookies[key] = value;
  });

  return cookies;
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `ib_session=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    "ib_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
  );
}

function getPlan(planId) {
  return PLANS[planId] || PLANS.free;
}

function planAllows(planId, feature) {
  if (planId === "free") {
    return false;
  }

  if (
    [
      "eligibility",
      "analyzer",
      "performance",
      "pricing",
      "contracts"
    ].includes(feature)
  ) {
    return true;
  }

  if (
    [
      "partner",
      "bid_package",
      "advanced_contracts"
    ].includes(feature)
  ) {
    return ["business", "enterprise"].includes(planId);
  }

  if (feature === "automation") {
    return planId === "enterprise";
  }

  return true;
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text
    };
  }
}

/*
========================================================
TEAMING PARTNER SOURCING
========================================================
Uses free, public federal data (SAM.gov entity registrations
and USASpending.gov award history) to surface real companies
InteliBid customers could team or subcontract with. This is
separate from the external "partner" agent (proposal/sales
package generation) configured above — it doesn't replace
that call, it runs alongside it. Every candidate is a lead
to vet, not a completed teaming agreement.
========================================================
*/

async function searchSamEntities({ naicsCode, state, excludeUei }) {
  if (!SAM_API_KEY || !naicsCode) {
    return [];
  }

  const params = new URLSearchParams({
    api_key: SAM_API_KEY,
    naicsCode: String(naicsCode),
    registrationStatus: "A",
    samRegistered: "Yes",
    includeSections: "entityRegistration,coreData"
  });

  if (state) {
    params.set("physicalAddressState", String(state));
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.sam.gov/entity-information/v3/entities?${params.toString()}`,
      {
        method: "GET",
        headers: { Accept: "application/json" }
      },
      20000
    );

    if (!response.ok) {
      console.error(
        "SAM.gov entity search failed:",
        response.status
      );
      return [];
    }

    const data = await readJsonResponse(response);
    const entities = Array.isArray(data.entityData)
      ? data.entityData
      : [];

    return entities
      .filter((entity) => {
        const uei = entity?.entityRegistration?.ueiSAM;
        return Boolean(uei) && uei !== excludeUei;
      })
      .slice(0, 25)
      .map((entity) => ({
        source: "sam_gov",
        entity_name:
          entity?.entityRegistration?.legalBusinessName ||
          "Unknown entity",
        uei: entity?.entityRegistration?.ueiSAM || null,
        naics_codes: String(naicsCode),
        set_aside_types: (
          entity?.coreData?.businessTypes?.businessTypeList || []
        )
          .map((item) => item.businessTypeDesc)
          .filter(Boolean)
          .join(", "),
        state:
          entity?.coreData?.physicalAddress
            ?.stateOrProvinceCode || null,
        city:
          entity?.coreData?.physicalAddress?.city || null,
        website: entity?.coreData?.entityURL || null,
        match_reason: `Active SAM.gov registration for NAICS ${naicsCode}`,
        award_amount: null,
        raw_data: entity
      }));
  } catch (err) {
    console.error(
      "SAM.gov entity search error:",
      err.message
    );
    return [];
  }
}

async function searchUsaSpendingPartners({ naicsCode, agency }) {
  if (!naicsCode) {
    return [];
  }

  const filters = {
    naics_codes: [String(naicsCode)],
    time_period: [
      {
        start_date: "2022-10-01",
        end_date: new Date().toISOString().slice(0, 10)
      }
    ],
    award_type_codes: ["A", "B", "C", "D"]
  };

  if (agency) {
    filters.agencies = [
      {
        type: "awarding",
        tier: "toptier",
        name: agency
      }
    ];
  }

  try {
    const response = await fetchWithTimeout(
      "https://api.usaspending.gov/api/v2/search/spending_by_award/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          filters,
          fields: [
            "Recipient Name",
            "Award Amount",
            "Awarding Agency",
            "Place of Performance State Code"
          ],
          page: 1,
          limit: 25,
          sort: "Award Amount",
          order: "desc",
          subawards: false
        })
      },
      20000
    );

    if (!response.ok) {
      console.error(
        "USASpending search failed:",
        response.status
      );
      return [];
    }

    const data = await readJsonResponse(response);
    const results = Array.isArray(data.results)
      ? data.results
      : [];

    const seen = new Set();

    return results
      .filter((row) => {
        const name = row["Recipient Name"];

        if (!name || seen.has(name)) {
          return false;
        }

        seen.add(name);
        return true;
      })
      .slice(0, 25)
      .map((row) => ({
        source: "usaspending_gov",
        entity_name: row["Recipient Name"] || "Unknown entity",
        uei: null,
        naics_codes: String(naicsCode),
        set_aside_types: null,
        state:
          row["Place of Performance State Code"] || null,
        city: null,
        website: null,
        match_reason: `Has won ${
          agency ? `${agency} ` : ""
        }federal awards in NAICS ${naicsCode}`,
        award_amount: row["Award Amount"] || null,
        raw_data: row
      }));
  } catch (err) {
    console.error(
      "USASpending search error:",
      err.message
    );
    return [];
  }
}

function generateCompanyId() {
  return (
    "IB-" +
    crypto
      .randomBytes(5)
      .toString("hex")
      .toUpperCase()
  );
}

function daysBetween(date) {
  if (!date) {
    return null;
  }

  const value = String(date).slice(0, 10);
  const target = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(target.getTime())) {
    return null;
  }

  const now = new Date();
  const today = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )
  );

  return Math.round(
    (target.getTime() - today.getTime()) / 86400000
  );
}

function contractStatus(contract) {
  const expirationDays = daysBetween(contract.expiration_date);
  const renewalDays = daysBetween(contract.renewal_date);

  if (
    expirationDays !== null &&
    expirationDays < 0
  ) {
    return "expired";
  }

  if (
    renewalDays !== null &&
    renewalDays >= 0 &&
    renewalDays <= 90
  ) {
    return "renewal_due";
  }

  if (
    expirationDays !== null &&
    expirationDays <= 90
  ) {
    return "expiring_soon";
  }

  return "active";
}

/*
========================================================
AUTH
========================================================
*/

async function getCurrentUser(req) {
  if (!databaseReady) {
    return null;
  }

  const cookies = parseCookies(req);
  const token = cookies.ib_session;

  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);

  const result = await query(
    `
    SELECT
      u.id,
      u.email,
      s.id AS session_id
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1
      AND s.expires_at > NOW()
    LIMIT 1
    `,
    [tokenHash]
  );

  return result.rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await getCurrentUser(req);

    if (!user) {
      if (req.path.startsWith("/api/")) {
        return res.status(401).json({
          error: "Authentication required"
        });
      }

      return res.redirect("/login");
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("Authentication error:", err.message);

    if (req.path.startsWith("/api/")) {
      return res.status(500).json({
        error: "Authentication service unavailable"
      });
    }

    return res.redirect("/login");
  }
}

async function getUserCompany(userId, companyId) {
  const result = await query(
    `
    SELECT
      c.*
    FROM companies c
    JOIN company_memberships cm
      ON cm.company_id = c.id
    WHERE cm.user_id = $1
      AND c.id = $2
    LIMIT 1
    `,
    [userId, companyId]
  );

  return result.rows[0] || null;
}

async function getUserCompanies(userId) {
  const result = await query(
    `
    SELECT
      c.*,
      COALESCE(s.plan_id, 'free') AS plan_id,
      COALESCE(s.status, 'active') AS subscription_status
    FROM companies c
    JOIN company_memberships cm
      ON cm.company_id = c.id
    LEFT JOIN subscriptions s
      ON s.company_id = c.id
    WHERE cm.user_id = $1
    ORDER BY c.created_at ASC
    `,
    [userId]
  );

  return result.rows;
}

/*
========================================================
HTML
========================================================
*/

function pageShell(title, content, options = {}) {
  const authenticated = options.authenticated || false;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} | InteliBid</title>

<style>
:root {
  --bg:#07111f;
  --panel:#0d1b2d;
  --panel2:#10243a;
  --border:#203b57;
  --text:#f4f7fb;
  --muted:#9fb0c3;
  --accent:#37b8ff;
  --accent2:#69d0ff;
  --success:#45d483;
  --warning:#ffc857;
  --danger:#ff6b6b;
}

* {
  box-sizing:border-box;
}

body {
  margin:0;
  font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  background:
    radial-gradient(circle at top right,#123a59 0,transparent 38%),
    var(--bg);
  color:var(--text);
}

a {
  color:inherit;
  text-decoration:none;
}

.container {
  width:min(1180px,92%);
  margin:0 auto;
}

.nav {
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:22px 0;
}

.logo {
  font-size:23px;
  font-weight:800;
  letter-spacing:-.5px;
}

.logo span {
  color:var(--accent);
}

.navlinks {
  display:flex;
  gap:12px;
  align-items:center;
}

.btn {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:12px 18px;
  border-radius:10px;
  border:1px solid var(--border);
  background:var(--panel);
  color:var(--text);
  cursor:pointer;
  font-weight:700;
}

.btn.primary {
  background:var(--accent);
  border-color:var(--accent);
  color:#04111d;
}

.btn.secondary {
  background:transparent;
}

.btn.danger {
  border-color:#743b3b;
  color:#ffb1b1;
}

.hero {
  padding:75px 0 55px;
  text-align:center;
}

.badge {
  display:inline-block;
  padding:7px 12px;
  border:1px solid #28516f;
  background:#0b2135;
  color:var(--accent2);
  border-radius:999px;
  font-size:13px;
  font-weight:800;
}

.hero h1 {
  font-size:clamp(42px,7vw,76px);
  line-height:.98;
  letter-spacing:-3px;
  margin:22px auto;
  max-width:850px;
}

.hero p {
  max-width:720px;
  margin:0 auto 28px;
  color:var(--muted);
  font-size:18px;
  line-height:1.7;
}

.actions {
  display:flex;
  justify-content:center;
  gap:12px;
  flex-wrap:wrap;
}

.grid {
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
  gap:18px;
}

.card {
  background:rgba(13,27,45,.9);
  border:1px solid var(--border);
  border-radius:16px;
  padding:22px;
}

.card h2,
.card h3 {
  margin-top:0;
}

.muted {
  color:var(--muted);
}

.section {
  padding:35px 0;
}

.pipeline {
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(190px,1fr));
  gap:12px;
}

.stage {
  border:1px solid var(--border);
  background:var(--panel);
  border-radius:13px;
  padding:16px;
}

.stage-number {
  color:var(--accent);
  font-size:13px;
  font-weight:800;
}

.stage-name {
  margin-top:7px;
  font-weight:800;
}

.stage-tagline {
  margin-top:5px;
  font-size:12.5px;
  color:var(--muted);
  line-height:1.4;
}

.trust-strip {
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(200px,1fr));
  gap:14px;
  margin-top:38px;
  padding-top:28px;
  border-top:1px solid var(--border);
}

.trust-item {
  display:flex;
  flex-direction:column;
  gap:4px;
}

.trust-item strong {
  font-size:14px;
}

.trust-item span {
  font-size:13px;
  color:var(--muted);
  line-height:1.4;
}

.faq {
  display:flex;
  flex-direction:column;
  gap:10px;
  margin-top:20px;
}

.faq details {
  border:1px solid var(--border);
  background:var(--panel);
  border-radius:13px;
  padding:16px 18px;
}

.faq summary {
  cursor:pointer;
  font-weight:700;
  list-style:none;
}

.faq summary::-webkit-details-marker {
  display:none;
}

.faq summary::after {
  content:"+";
  float:right;
  color:var(--accent);
  font-weight:800;
}

.faq details[open] summary::after {
  content:"–";
}

.faq p {
  margin:12px 0 0;
}

.form {
  width:min(600px,100%);
  margin:40px auto;
}

label {
  display:block;
  margin:16px 0 7px;
  font-weight:700;
}

input,
textarea,
select {
  width:100%;
  padding:13px 14px;
  border-radius:9px;
  border:1px solid var(--border);
  background:#081625;
  color:var(--text);
  font-size:15px;
}

textarea {
  min-height:120px;
  resize:vertical;
}

.stat {
  font-size:30px;
  font-weight:800;
  margin:7px 0;
}

.price {
  font-size:36px;
  font-weight:900;
}

.price small {
  font-size:14px;
  color:var(--muted);
}

.plan {
  position:relative;
}

.plan.featured {
  border-color:var(--accent);
  box-shadow:0 0 0 1px rgba(55,184,255,.18);
}

.featured-label {
  position:absolute;
  top:-12px;
  right:18px;
  background:var(--accent);
  color:#03101b;
  padding:5px 9px;
  border-radius:999px;
  font-size:11px;
  font-weight:900;
}

ul {
  color:var(--muted);
  line-height:1.8;
  padding-left:20px;
}

.notice {
  padding:15px;
  border-radius:11px;
  background:#0a2135;
  border:1px solid #214663;
  color:#bde8ff;
  margin:15px 0;
}

.warning {
  border-color:#69521e;
  background:#2b2411;
  color:#ffe39a;
}

.success {
  border-color:#235b3d;
  background:#0c291c;
  color:#a8f2c7;
}

.danger {
  border-color:#633636;
  background:#2a1515;
  color:#ffb6b6;
}

.table {
  width:100%;
  border-collapse:collapse;
}

.table th,
.table td {
  padding:12px;
  text-align:left;
  border-bottom:1px solid var(--border);
  vertical-align:top;
}

.small {
  font-size:13px;
}

.locked {
  opacity:.72;
}

footer {
  padding:50px 0;
  color:var(--muted);
  text-align:center;
}

.footer-links {
  display:flex;
  justify-content:center;
  gap:22px;
  margin-bottom:16px;
  flex-wrap:wrap;
}

.footer-links a {
  color:var(--muted);
  font-weight:600;
  font-size:13px;
}

.footer-links a:hover {
  color:var(--accent);
}

.footer-note {
  font-size:12.5px;
  line-height:1.6;
  max-width:520px;
  margin:0 auto;
}

@media(max-width:700px) {
  .navlinks {
    gap:6px;
  }

  .navlinks .hide-mobile {
    display:none;
  }

  .hero {
    padding-top:45px;
  }

  .hero h1 {
    letter-spacing:-2px;
  }

  .table {
    font-size:13px;
  }
}
</style>
</head>

<body>

<div class="container">

<nav class="nav">
  <a class="logo" href="/">Inteli<span>Bid</span></a>

  <div class="navlinks">
    <a class="btn secondary hide-mobile" href="/plans">Plans</a>
    ${
      authenticated
        ? `
          <a class="btn secondary" href="/dashboard">Dashboard</a>
          <form method="POST" action="/api/auth/logout" style="display:inline">
            <button class="btn secondary" type="submit">Logout</button>
          </form>
        `
        : `
          <a class="btn secondary" href="/login">Login</a>
          <a class="btn primary" href="/signup">Get Started</a>
        `
    }
  </div>
</nav>

${content}

<footer>
  <div class="footer-links">
    <a href="/plans">Plans</a>
    <a href="/about">About</a>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
  </div>
  <div class="footer-note">
    InteliBid 5.3 GOV/CON — Intelligent Bidding. Smarter Contracts.
    <br>
    Bid packages require human approval before submission. InteliBid does
    not submit bids to the government on your behalf.
  </div>
</footer>

</div>

</body>
</html>`;
}

/*
========================================================
FRONT DOOR
========================================================
*/

app.get("/", (req, res) => {
  res.send(
    pageShell(
      "Intelligent Bidding. Smarter Contracts.",
      `
      <section class="hero">

        <div class="badge">INTELIBID 5.3 — GOV/CON</div>

        <h1>
          Win more government contracts<br>
          without hiring a BD team.
        </h1>

        <p>
          InteliBid takes your company profile and runs it through eight
          stages — opportunity discovery, eligibility, contract analysis,
          performance fit, pricing, teaming partners, and bid packaging —
          so a small or mid-size contractor can compete like one with a
          full capture team behind it.
        </p>

        <div class="actions">
          <a class="btn primary" href="/signup">
            Start Free — No Card Required
          </a>

          <a class="btn secondary" href="/plans">
            View Plans
          </a>
        </div>

        <div class="trust-strip">
          <div class="trust-item">
            <strong>Human approval required</strong>
            <span>InteliBid never submits a bid on your behalf. Ever.</span>
          </div>
          <div class="trust-item">
            <strong>Self-serve, no sales calls</strong>
            <span>Sign up and see real results before you pay anything.</span>
          </div>
          <div class="trust-item">
            <strong>Public federal data</strong>
            <span>Built on SAM.gov and USASpending.gov, not black-box scores.</span>
          </div>
        </div>

      </section>

      <section class="section">

        <div class="grid">

          <div class="card">
            <h3>01 — Discover</h3>
            <p class="muted">
              Find government opportunities based on
              your company's capabilities and profile.
            </p>
          </div>

          <div class="card">
            <h3>02 — Analyze</h3>
            <p class="muted">
              Move qualified opportunities through
              eligibility and contract intelligence.
            </p>
          </div>

          <div class="card">
            <h3>03 — Team &amp; Price</h3>
            <p class="muted">
              Find teaming partners, evaluate performance
              requirements, and model pricing to win.
            </p>
          </div>

          <div class="card">
            <h3>04 — Track</h3>
            <p class="muted">
              Track contracts, expiration dates,
              renewals and important deadlines.
            </p>
          </div>

        </div>

      </section>

      <section class="section">

        <h2>One operating pipeline</h2>

        <p class="muted">
          Eight stages, start to finish. Every stage records what it did
          and why, so you can see the reasoning, not just a score.
        </p>

        <div class="pipeline">

          ${PIPELINE_STAGES.map(
            (stage) => `
              <div class="stage" title="${escapeHtml(
                stage.description
              )}">
                <div class="stage-number">
                  ${String(stage.number).padStart(2, "0")}
                </div>
                <div class="stage-name">
                  ${escapeHtml(stage.name)}
                </div>
                <div class="stage-tagline">
                  ${escapeHtml(stage.tagline)}
                </div>
              </div>
            `
          ).join("")}

        </div>

      </section>

      <section class="section">

        <h2>Why this doesn't look like every other tool</h2>

        <div class="grid">

          <div class="card">
            <h3>We name our data sources</h3>
            <p class="muted">
              Teaming and subcontractor matches come straight from
              SAM.gov's active entity registrations and USASpending.gov's
              public award history — the same federal data anyone can
              query, surfaced in one place instead of three tabs.
            </p>
          </div>

          <div class="card">
            <h3>No automatic submission</h3>
            <p class="muted">
              InteliBid prepares. It does not submit. Every bid package
              stops at a human approval step before anything reaches a
              contracting officer. That's a hard rule in the platform,
              not a setting you can turn off.
            </p>
          </div>

          <div class="card">
            <h3>Transparent, published pricing</h3>
            <p class="muted">
              No "request a demo" wall. Every plan and its exact limits
              are on the <a href="/plans">plans page</a> — start free,
              upgrade only when you're getting value.
            </p>
          </div>

        </div>

      </section>

      <section class="section">

        <h2>Built for contractors priced out of enterprise tools</h2>

        <p class="muted">
          Large market-intelligence platforms in this space are built for
          teams with dedicated capture staff and enterprise budgets, often
          in the hundreds to low thousands of dollars per month with sales
          calls required to see pricing. InteliBid is built for the
          contractor doing capture themselves — self-serve, starting free,
          topping out at a fraction of that cost.
        </p>

      </section>

      <section class="section">

        <h2>Common questions</h2>

        <div class="faq">

          <details>
            <summary>Does InteliBid submit bids automatically?</summary>
            <p class="muted">
              No. InteliBid prepares a bid package and stops. A person on
              your team has to review and approve it. There is no
              automated-submission feature — by design.
            </p>
          </details>

          <details>
            <summary>Where does the opportunity and partner data come from?</summary>
            <p class="muted">
              Opportunity discovery runs through our Hunter service against
              live federal solicitations. Teaming-partner sourcing pulls
              directly from SAM.gov entity registrations and
              USASpending.gov award history — public federal data sources,
              not a proprietary black box.
            </p>
          </details>

          <details>
            <summary>Is there a contract or cancellation fee?</summary>
            <p class="muted">
              No. Plans are month-to-month. Start on the free plan, upgrade
              when it's earning its keep, cancel any time from your account.
            </p>
          </details>

          <details>
            <summary>Who is behind InteliBid?</summary>
            <p class="muted">
              InteliBid is a self-serve gov-con intelligence platform.
              For company and contact details, see the
              <a href="/about">About page</a>.
            </p>
          </details>

        </div>

      </section>
      `
    )
  );
});

/*
========================================================
ABOUT / TRUST PAGES

Placeholder legal content. Replace the bracketed fields
with your real company details before taking payments —
these are structural pages, not legal advice.
========================================================
*/

app.get("/about", (req, res) => {
  res.send(
    pageShell(
      "About",
      `
      <section class="section">

        <div class="badge">ABOUT INTELIBID</div>

        <h1>About InteliBid</h1>

        <p class="muted">
          InteliBid is a self-serve platform that helps small and
          mid-size government contractors find, evaluate, team on, and
          prepare bids for federal opportunities — without an enterprise
          sales process or an enterprise budget.
        </p>

        <div class="card" style="margin-top:24px">
          <h3>Company</h3>
          <p class="muted">
            [Add your registered legal business name here]<br>
            [Add your business address here]<br>
            [Add a support/contact email here]
          </p>
        </div>

        <div class="card" style="margin-top:16px">
          <h3>How we handle your data</h3>
          <p class="muted">
            See our <a href="/privacy">Privacy Policy</a> for details on
            what we collect and how it's used. Opportunity and teaming
            data is sourced from public federal systems (SAM.gov,
            USASpending.gov) and connected agent services described on
            the homepage.
          </p>
        </div>

      </section>
      `
    )
  );
});

app.get("/privacy", (req, res) => {
  res.send(
    pageShell(
      "Privacy Policy",
      `
      <section class="section">

        <div class="badge">PRIVACY</div>

        <h1>Privacy Policy</h1>

        <p class="muted">
          This is a starting template, not a finished legal document.
          Have it reviewed by counsel before relying on it.
        </p>

        <div class="card" style="margin-top:24px">
          <h3>What we collect</h3>
          <p class="muted">
            Account details you provide (name, email, company profile
            data), and usage data needed to run the pipeline (opportunity
            searches, pipeline runs, and their results).
          </p>
        </div>

        <div class="card" style="margin-top:16px">
          <h3>What we don't do</h3>
          <p class="muted">
            We don't sell your company profile or pipeline data to third
            parties. Payment is processed by Stripe — InteliBid does not
            store your card details directly.
          </p>
        </div>

        <div class="card" style="margin-top:16px">
          <h3>Contact</h3>
          <p class="muted">
            [Add a privacy/support contact email here]
          </p>
        </div>

      </section>
      `
    )
  );
});

app.get("/terms", (req, res) => {
  res.send(
    pageShell(
      "Terms of Service",
      `
      <section class="section">

        <div class="badge">TERMS</div>

        <h1>Terms of Service</h1>

        <p class="muted">
          This is a starting template, not a finished legal document.
          Have it reviewed by counsel before relying on it.
        </p>

        <div class="card" style="margin-top:24px">
          <h3>What InteliBid does and doesn't do</h3>
          <p class="muted">
            InteliBid prepares bid intelligence and draft bid packages.
            It does not submit proposals to the government on your
            behalf under any circumstances — a human on your team must
            review and approve every submission. InteliBid does not
            guarantee contract award.
          </p>
        </div>

        <div class="card" style="margin-top:16px">
          <h3>Billing</h3>
          <p class="muted">
            Plans are billed monthly through Stripe. You can cancel at
            any time from your account; no long-term contract is
            required.
          </p>
        </div>

        <div class="card" style="margin-top:16px">
          <h3>Contact</h3>
          <p class="muted">
            [Add a legal/support contact email here]
          </p>
        </div>

      </section>
      `
    )
  );
});

/*
========================================================
PLANS
========================================================
*/

app.get("/plans", (req, res) => {
  const cards = Object.values(PLANS)
    .map((plan) => {
      const featured =
        plan.id === "professional";

      return `
        <div class="card plan ${
          featured ? "featured" : ""
        }">

          ${
            featured
              ? `<div class="featured-label">MOST POPULAR</div>`
              : ""
          }

          <h2>${escapeHtml(plan.name)}</h2>

          <div class="price">
            ${
              plan.id === "enterprise"
                ? "$699+"
                : `$${plan.monthly}`
            }
            <small>/month</small>
          </div>

          <p class="muted">
            ${
              plan.id === "free"
                ? "See the value before upgrading."
                : "Built for serious government contracting."
            }
          </p>

          <ul>
            ${plan.features
              .map(
                (feature) =>
                  `<li>${escapeHtml(feature)}</li>`
              )
              .join("")}
          </ul>

          <a
            class="btn ${
              featured ? "primary" : "secondary"
            }"
            style="width:100%"
            href="/signup?plan=${encodeURIComponent(
              plan.id
            )}"
          >
            ${
              plan.id === "free"
                ? "Start Free"
                : `Start ${escapeHtml(plan.name)}`
            }
          </a>

        </div>
      `;
    })
    .join("");

  res.send(
    pageShell(
      "Plans",
      `
      <section class="section">

        <div class="hero" style="padding-top:25px">

          <div class="badge">SIMPLE SELF-SERVICE PLANS</div>

          <h1 style="font-size:52px">
            Choose your intelligence level.
          </h1>

          <p>
            Start free. Upgrade when you need deeper
            contract intelligence and automation.
          </p>

        </div>

        <div class="grid">
          ${cards}
        </div>

        <div class="notice" style="margin-top:25px">
          Paid plans are designed to activate automatically
          through online billing when Stripe is configured.
          No sales call is required.
        </div>

      </section>
      `
    )
  );
});

/*
========================================================
SIGNUP
========================================================
*/

app.get("/signup", (req, res) => {
  const requestedPlan = String(
    req.query.plan || "free"
  ).toLowerCase();

  const plan = getPlan(requestedPlan);

  res.send(
    pageShell(
      "Create Account",
      `
      <section class="section">

        <div class="form">

          <div class="card">

            <div class="badge">
              ${escapeHtml(plan.name.toUpperCase())}
            </div>

            <h1>Create your InteliBid account</h1>

            <p class="muted">
              Your company profile starts blank.
              InteliBid uses your information to personalize
              the intelligence it provides.
            </p>

            <form method="POST" action="/api/auth/signup">

              <input
                type="hidden"
                name="plan"
                value="${escapeHtml(plan.id)}"
              >

              <label>Email</label>

              <input
                name="email"
                type="email"
                required
                autocomplete="email"
                placeholder="you@company.com"
              >

              <label>Password</label>

              <input
                name="password"
                type="password"
                required
                minlength="8"
                autocomplete="new-password"
                placeholder="At least 8 characters"
              >

              <button
                class="btn primary"
                style="width:100%;margin-top:20px"
                type="submit"
              >
                Create Account
              </button>

            </form>

            <p class="muted small">
              Already have an account?
              <a href="/login" style="color:var(--accent)">
                Login
              </a>
            </p>

          </div>

        </div>

      </section>
      `
    )
  );
});

app.post("/api/auth/signup", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const requestedPlan = String(
    req.body.plan || "free"
  ).toLowerCase();

  if (!email || !email.includes("@")) {
    return res.status(400).send("Valid email required.");
  }

  if (password.length < 8) {
    return res
      .status(400)
      .send("Password must be at least 8 characters.");
  }

  if (!databaseReady) {
    return res
      .status(503)
      .send(
        "InteliBid database is temporarily unavailable. Please try again."
      );
  }

  const selectedPlan = getPlan(requestedPlan);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    if (existing.rows.length) {
      await client.query("ROLLBACK");

      return res.redirect(
        `/login?email=${encodeURIComponent(email)}`
      );
    }

    const userId = crypto.randomUUID();

    await client.query(
      `
      INSERT INTO users (
        id,
        email,
        password_hash
      )
      VALUES ($1,$2,$3)
      `,
      [
        userId,
        email,
        hashPassword(password)
      ]
    );

    const company = {
      id: crypto.randomUUID(),
      company_id: generateCompanyId()
    };

    await client.query(
      `
      INSERT INTO companies (
        id,
        company_id,
        name,
        legal_name
      )
      VALUES ($1,$2,$3,$4)
      `,
      [
        company.id,
        company.company_id,
        "New Company",
        ""
      ]
    );

    await client.query(
      `
      INSERT INTO company_memberships (
        id,
        user_id,
        company_id,
        role
      )
      VALUES ($1,$2,$3,'owner')
      `,
      [
        crypto.randomUUID(),
        userId,
        company.id
      ]
    );

    await client.query(
      `
      INSERT INTO subscriptions (
        id,
        company_id,
        plan_id,
        status
      )
      VALUES ($1,$2,$3,$4)
      `,
      [
        crypto.randomUUID(),
        company.id,
        selectedPlan.id,
        selectedPlan.id === "free"
          ? "active"
          : "pending"
      ]
    );

    const token = createSessionToken();

    await client.query(
      `
      INSERT INTO sessions (
        id,
        user_id,
        token_hash,
        expires_at
      )
      VALUES ($1,$2,$3,NOW() + INTERVAL '7 days')
      `,
      [
        crypto.randomUUID(),
        userId,
        hashToken(token)
      ]
    );

    await client.query("COMMIT");

    setSessionCookie(res, token);

    if (
      selectedPlan.id !== "free" &&
      STRIPE_SECRET_KEY &&
      STRIPE_PRICE_IDS[selectedPlan.id]
    ) {
      return res.redirect(
        `/api/billing/checkout?plan=${encodeURIComponent(
          selectedPlan.id
        )}`
      );
    }

    return res.redirect("/company-profile");
  } catch (err) {
    await client.query("ROLLBACK");

    console.error("Signup error:", err);

    return res
      .status(500)
      .send("Unable to create account.");
  } finally {
    client.release();
  }
});

/*
========================================================
LOGIN
========================================================
*/

app.get("/login", (req, res) => {
  res.send(
    pageShell(
      "Login",
      `
      <section class="section">

        <div class="form">

          <div class="card">

            <div class="badge">SECURE LOGIN</div>

            <h1>Welcome back</h1>

            <form method="POST" action="/api/auth/login">

              <label>Email</label>

              <input
                name="email"
                type="email"
                required
                autocomplete="email"
                value="${escapeHtml(
                  req.query.email || ""
                )}"
              >

              <label>Password</label>

              <input
                name="password"
                type="password"
                required
                autocomplete="current-password"
              >

              <button
                class="btn primary"
                style="width:100%;margin-top:20px"
                type="submit"
              >
                Login
              </button>

            </form>

          </div>

        </div>

      </section>
      `
    )
  );
});

app.post("/api/auth/login", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!databaseReady) {
    return res
      .status(503)
      .send("Database temporarily unavailable.");
  }

  try {
    const result = await query(
      `
      SELECT id,email,password_hash
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [email]
    );

    const user = result.rows[0];

    if (
      !user ||
      !verifyPassword(password, user.password_hash)
    ) {
      return res
        .status(401)
        .send("Invalid email or password.");
    }

    const token = createSessionToken();

    await query(
      `
      INSERT INTO sessions (
        id,
        user_id,
        token_hash,
        expires_at
      )
      VALUES ($1,$2,$3,NOW() + INTERVAL '7 days')
      `,
      [
        crypto.randomUUID(),
        user.id,
        hashToken(token)
      ]
    );

    setSessionCookie(res, token);

    res.redirect("/dashboard");
  } catch (err) {
    console.error("Login error:", err.message);

    res
      .status(500)
      .send("Unable to login.");
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req);

    if (cookies.ib_session && databaseReady) {
      await query(
        `
        DELETE FROM sessions
        WHERE token_hash = $1
        `,
        [hashToken(cookies.ib_session)]
      );
    }
  } catch (err) {
    console.error("Logout error:", err.message);
  }

  clearSessionCookie(res);

  res.redirect("/");
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email
    }
  });
});

/*
========================================================
COMPANY PROFILE
========================================================
*/

app.get(
  "/company-profile",
  requireAuth,
  async (req, res) => {
    try {
      const companies = await getUserCompanies(
        req.user.id
      );

      const company = companies[0];

      if (!company) {
        return res.redirect("/dashboard");
      }

      res.send(
        pageShell(
          "Company Profile",
          `
          <section class="section">

            <div class="form">

              <div class="card">

                <div class="badge">
                  COMPANY PROFILE
                </div>

                <h1>
                  Build your company intelligence profile
                </h1>

                <p class="muted">
                  This information becomes the foundation
                  InteliBid uses to evaluate opportunities
                  for your company.
                </p>

                <div class="notice">
                  Company ID:
                  <strong>
                    ${escapeHtml(company.company_id)}
                  </strong>
                </div>

                <form method="POST" action="/api/company-profile">

                  <label>Company Name</label>

                  <input
                    name="name"
                    required
                    value="${escapeHtml(
                      company.name === "New Company"
                        ? ""
                        : company.name
                    )}"
                    placeholder="Your company name"
                  >

                  <label>Legal Name</label>

                  <input
                    name="legal_name"
                    value="${escapeHtml(
                      company.legal_name
                    )}"
                  >

                  <label>Website</label>

                  <input
                    name="website"
                    value="${escapeHtml(
                      company.website
                    )}"
                    placeholder="https://..."
                  >

                  <label>Company Description</label>

                  <textarea
                    name="description"
                    placeholder="What does your company do?"
                  >${escapeHtml(
                    company.description
                  )}</textarea>

                  <label>Address</label>

                  <input
                    name="address"
                    value="${escapeHtml(
                      company.address
                    )}"
                  >

                  <label>City</label>

                  <input
                    name="city"
                    value="${escapeHtml(
                      company.city
                    )}"
                  >

                  <label>State</label>

                  <input
                    name="state"
                    value="${escapeHtml(
                      company.state
                    )}"
                  >

                  <label>ZIP Code</label>

                  <input
                    name="zip"
                    value="${escapeHtml(
                      company.zip
                    )}"
                  >

                  <label>NAICS Codes</label>

                  <input
                    name="naics_codes"
                    value="${escapeHtml(
                      company.naics_codes
                    )}"
                    placeholder="561720, 561730"
                  >

                  <label>Capabilities</label>

                  <textarea
                    name="capabilities"
                    placeholder="Describe your services and capabilities."
                  >${escapeHtml(
                    company.capabilities
                  )}</textarea>

                  <label>Certifications / Set-Asides</label>

                  <textarea
                    name="certifications"
                    placeholder="8(a), SDVOSB, WOSB, HUBZone, etc."
                  >${escapeHtml(
                    company.certifications
                  )}</textarea>

                  <label>Government Experience</label>

                  <textarea
                    name="government_experience"
                  >${escapeHtml(
                    company.government_experience
                  )}</textarea>

                  <label>Annual Revenue</label>

                  <input
                    name="annual_revenue"
                    value="${escapeHtml(
                      company.annual_revenue
                    )}"
                  >

                  <label>Employees</label>

                  <input
                    name="employees"
                    value="${escapeHtml(
                      company.employees
                    )}"
                  >

                  <label>Preferred Contract Size</label>

                  <input
                    name="preferred_contract_size"
                    value="${escapeHtml(
                      company.preferred_contract_size
                    )}"
                    placeholder="$100,000 - $1,000,000"
                  >

                  <label>Target Agencies</label>

                  <textarea
                    name="target_agencies"
                  >${escapeHtml(
                    company.target_agencies
                  )}</textarea>

                  <label>Target States</label>

                  <input
                    name="target_states"
                    value="${escapeHtml(
                      company.target_states
                    )}"
                    placeholder="TX, OK, AR"
                  >

                  <button
                    class="btn primary"
                    style="width:100%;margin-top:20px"
                    type="submit"
                  >
                    Save Company Profile
                  </button>

                </form>

              </div>

            </div>

          </section>
          `
        )
      );
    } catch (err) {
      console.error(err);

      res
        .status(500)
        .send("Unable to load company profile.");
    }
  }
);

app.post(
  "/api/company-profile",
  requireAuth,
  async (req, res) => {
    const fields = [
      "name",
      "legal_name",
      "website",
      "description",
      "address",
      "city",
      "state",
      "zip",
      "naics_codes",
      "capabilities",
      "certifications",
      "government_experience",
      "annual_revenue",
      "employees",
      "preferred_contract_size",
      "target_agencies",
      "target_states"
    ];

    try {
      const companies = await getUserCompanies(
        req.user.id
      );

      const company = companies[0];

      if (!company) {
        return res.status(404).send("Company not found.");
      }

      const values = fields.map(
        (field) => req.body[field] || ""
      );

      await query(
        `
        UPDATE companies
        SET
          name=$1,
          legal_name=$2,
          website=$3,
          description=$4,
          address=$5,
          city=$6,
          state=$7,
          zip=$8,
          naics_codes=$9,
          capabilities=$10,
          certifications=$11,
          government_experience=$12,
          annual_revenue=$13,
          employees=$14,
          preferred_contract_size=$15,
          target_agencies=$16,
          target_states=$17,
          updated_at=NOW()
        WHERE id=$18
        `,
        [...values, company.id]
      );

      res.redirect("/dashboard");
    } catch (err) {
      console.error(
        "Company profile error:",
        err.message
      );

      res
        .status(500)
        .send("Unable to save company profile.");
    }
  }
);

/*
========================================================
DASHBOARD
========================================================
*/

app.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const companies = await getUserCompanies(
      req.user.id
    );

    if (!companies.length) {
      return res.redirect("/company-profile");
    }

    const company = companies[0];
    const plan = getPlan(company.plan_id);

    const opportunityCount = await query(
      `
      SELECT COUNT(*)::int AS count
      FROM opportunities
      WHERE company_id=$1
      `,
      [company.id]
    );

    const pipelineCount = await query(
      `
      SELECT COUNT(*)::int AS count
      FROM pipeline_runs
      WHERE company_id=$1
      `,
      [company.id]
    );

    const contracts = await query(
      `
      SELECT *
      FROM contracts
      WHERE company_id=$1
      ORDER BY expiration_date ASC NULLS LAST
      LIMIT 10
      `,
      [company.id]
    );

    const activeContracts = contracts.rows.filter(
      (contract) =>
        contractStatus(contract) !== "expired"
    ).length;

    res.send(
      pageShell(
        "Dashboard",
        `
        <section class="section">

          <div style="
            display:flex;
            justify-content:space-between;
            gap:15px;
            flex-wrap:wrap;
            align-items:end;
          ">

            <div>
              <div class="badge">CUSTOMER DASHBOARD</div>

              <h1>
                ${escapeHtml(company.name)}
              </h1>

              <p class="muted">
                Company ID:
                <strong>
                  ${escapeHtml(company.company_id)}
                </strong>
              </p>
            </div>

            <div class="actions">

              <a
                class="btn secondary"
                href="/company-profile"
              >
                Company Profile
              </a>

              <a
                class="btn primary"
                href="/hunter"
              >
                Find Opportunities
              </a>

            </div>

          </div>

        </section>

        <section class="section">

          <div class="grid">

            <div class="card">
              <div class="muted">Plan</div>
              <div class="stat">
                ${escapeHtml(plan.name)}
              </div>
              <div class="muted">
                ${
                  plan.id === "enterprise"
                    ? "$699+/month"
                    : `$${plan.monthly}/month`
                }
              </div>
            </div>

            <div class="card">
              <div class="muted">Opportunities</div>
              <div class="stat">
                ${opportunityCount.rows[0].count}
              </div>
            </div>

            <div class="card">
              <div class="muted">Pipeline Runs</div>
              <div class="stat">
                ${pipelineCount.rows[0].count}
              </div>
            </div>

            <div class="card">
              <div class="muted">Tracked Contracts</div>
              <div class="stat">
                ${contracts.rows.length}
              </div>
              <div class="muted">
                ${activeContracts} active
              </div>
            </div>

          </div>

        </section>

        <section class="section">

          <div class="card">

            <h2>Contract Watch</h2>

            ${
              contracts.rows.length
                ? `
                  <table class="table">

                    <thead>
                      <tr>
                        <th>Contract</th>
                        <th>Expiration</th>
                        <th>Renewal</th>
                        <th>Status</th>
                      </tr>
                    </thead>

                    <tbody>

                      ${contracts.rows
                        .map((contract) => {
                          const status =
                            contractStatus(contract);

                          const expirationDays =
                            daysBetween(
                              contract.expiration_date
                            );

                          const renewalDays =
                            daysBetween(
                              contract.renewal_date
                            );

                          return `
                            <tr>

                              <td>
                                <strong>
                                  ${escapeHtml(
                                    contract.title
                                  )}
                                </strong>

                                <div class="muted small">
                                  ${escapeHtml(
                                    contract.agency || ""
                                  )}
                                </div>
                              </td>

                              <td>
                                ${
                                  contract.expiration_date
                                    ? new Date(
                                        contract.expiration_date
                                      ).toLocaleDateString()
                                    : "Not set"
                                }

                                ${
                                  expirationDays !== null
                                    ? `
                                      <div class="small muted">
                                        ${
                                          expirationDays < 0
                                            ? "Expired"
                                            : `${expirationDays} days remaining`
                                        }
                                      </div>
                                    `
                                    : ""
                                }
                              </td>

                              <td>
                                ${
                                  contract.renewal_date
                                    ? new Date(
                                        contract.renewal_date
                                      ).toLocaleDateString()
                                    : "Not set"
                                }

                                ${
                                  renewalDays !== null &&
                                  renewalDays >= 0 &&
                                  renewalDays <= 90
                                    ? `
                                      <div class="small" style="color:var(--warning)">
                                        Renewal approaching
                                      </div>
                                    `
                                    : ""
                                }
                              </td>

                              <td>
                                ${escapeHtml(
                                  status.replace(
                                    "_",
                                    " "
                                  ).toUpperCase()
                                )}
                              </td>

                            </tr>
                          `;
                        })
                        .join("")}

                    </tbody>

                  </table>
                `
                : `
                  <div class="notice">
                    No contracts are being tracked yet.
                    Once contracts are added, InteliBid will
                    monitor expiration and renewal dates.
                  </div>
                `
            }

            <a
              class="btn secondary"
              href="/contracts"
              style="margin-top:18px"
            >
              Open Contract Intelligence
            </a>

          </div>

        </section>

        <section class="section">

          <div class="card">

            <h2>8-Stage Gov/Con Pipeline</h2>

            <div class="pipeline">

              ${PIPELINE_STAGES.map(
                (stage) => `
                  <div class="stage" title="${escapeHtml(
                    stage.description
                  )}">

                    <div class="stage-number">
                      ${String(
                        stage.number
                      ).padStart(2, "0")}
                    </div>

                    <div class="stage-name">
                      ${escapeHtml(
                        stage.name
                      )}
                    </div>

                    <div class="stage-tagline">
                      ${escapeHtml(
                        stage.tagline
                      )}
                    </div>

                  </div>
                `
              ).join("")}

            </div>

          </div>

        </section>
        `
      )
    );
  } catch (err) {
    console.error("Dashboard error:", err.message);

    res
      .status(500)
      .send("Unable to load dashboard.");
  }
});

/*
========================================================
HUNTER
========================================================
*/

app.get("/hunter", requireAuth, async (req, res) => {
  try {
    const companies = await getUserCompanies(
      req.user.id
    );

    const company = companies[0];

    if (!company) {
      return res.redirect("/company-profile");
    }

    const opportunities = await query(
      `
      SELECT *
      FROM opportunities
      WHERE company_id=$1
      ORDER BY created_at DESC
      LIMIT 25
      `,
      [company.id]
    );

    const plan = getPlan(company.plan_id);

    res.send(
      pageShell(
        "Opportunity Hunter",
        `
        <section class="section">

          <div class="badge">
            HUNTER — AGENT #1
          </div>

          <h1>
            Find opportunities your company can pursue.
          </h1>

          <p class="muted">
            Search is driven through the Hunter service
            and connected to your company profile.
          </p>

          <div class="notice">
            Current plan:
            <strong>
              ${escapeHtml(plan.name)}
            </strong>
          </div>

          <div class="card">

            <form method="POST" action="/api/hunter/search">

              <label>
                Search keyword
              </label>

              <input
                name="keyword"
                required
                placeholder="janitorial, transportation, waste management..."
              >

              <input
                type="hidden"
                name="companyId"
                value="${escapeHtml(company.id)}"
              >

              <button
                class="btn primary"
                type="submit"
                style="margin-top:15px"
              >
                Search Government Opportunities
              </button>

            </form>

          </div>

        </section>

        <section class="section">

          <h2>Opportunity Feed</h2>

          ${
            opportunities.rows.length
              ? `
                <div class="grid">

                  ${opportunities.rows
                    .map(
                      (opportunity) => `
                        <div class="card">

                          <div class="badge">
                            ${
                              opportunity.match_score
                                ? `${opportunity.match_score}% MATCH`
                                : "OPPORTUNITY"
                            }
                          </div>

                          <h3>
                            ${escapeHtml(
                              opportunity.title ||
                                "Government Opportunity"
                            )}
                          </h3>

                          <p class="muted">
                            ${escapeHtml(
                              opportunity.agency ||
                                "Agency not specified"
                            )}
                          </p>

                          <p>
                            <strong>NAICS:</strong>
                            ${escapeHtml(
                              opportunity.naics_code ||
                                "Not specified"
                            )}
                          </p>

                          <p>
                            <strong>Deadline:</strong>
                            ${
                              opportunity.response_deadline
                                ? new Date(
                                    opportunity.response_deadline
                                  ).toLocaleString()
                                : "Not specified"
                            }
                          </p>

                          <a
                            class="btn secondary"
                            href="/opportunity/${encodeURIComponent(
                              opportunity.id
                            )}"
                          >
                            View Opportunity
                          </a>

                        </div>
                      `
                    )
                    .join("")}

                </div>
              `
              : `
                <div class="notice">
                  No opportunities have been imported yet.
                  Run Hunter to begin discovery.
                </div>
              `
          }

        </section>
        `
      )
    );
  } catch (err) {
    console.error("Hunter page error:", err.message);

    res
      .status(500)
      .send("Unable to load Hunter.");
  }
});

app.post(
  "/api/hunter/search",
  requireAuth,
  async (req, res) => {
    const keyword = String(
      req.body.keyword || ""
    ).trim();

    const companyId = String(
      req.body.companyId || ""
    );

    if (!keyword) {
      return res
        .status(400)
        .send("Keyword required.");
    }

    try {
      const company = await getUserCompany(
        req.user.id,
        companyId
      );

      if (!company) {
        return res
          .status(403)
          .send("Company access denied.");
      }

      const subscription = await query(
        `
        SELECT plan_id
        FROM subscriptions
        WHERE company_id=$1
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [company.id]
      );

      const plan = getPlan(
        subscription.rows[0]?.plan_id || "free"
      );

      if (!databaseReady) {
        return res
          .status(503)
          .send("Database unavailable.");
      }

      const endpoint =
        SERVICE_URLS.hunter.replace(/\/$/, "") +
        "/search?keyword=" +
        encodeURIComponent(keyword);

      const response =
        await fetchWithTimeout(
          endpoint,
          {
            headers: {
              Accept: "application/json"
            }
          },
          30000
        );

      const data =
        await readJsonResponse(response);

      if (!response.ok) {
        console.error(
          "Hunter returned:",
          response.status,
          safeJson(data).slice(0, 1000)
        );

        return res
          .status(502)
          .send(
            "Hunter service returned an error."
          );
      }

      let results = [];

      if (Array.isArray(data)) {
        results = data;
      } else if (Array.isArray(data.results)) {
        results = data.results;
      } else if (Array.isArray(data.opportunities)) {
        results = data.opportunities;
      } else if (Array.isArray(data.data)) {
        results = data.data;
      }

      const inserted = [];

      for (const item of results.slice(
        0,
        plan.maxOpportunities
      )) {
        const externalNoticeId =
          item.noticeId ||
          item.notice_id ||
          item.id ||
          item.solicitationNumber ||
          item.solicitation_number ||
          crypto.randomUUID();

        const title =
          item.title ||
          item.name ||
          item.opportunityTitle ||
          "Government Opportunity";

        const agency =
          item.agency ||
          item.department ||
          item.organization ||
          "";

        const naics =
          item.naicsCode ||
          item.naics_code ||
          item.naics ||
          "";

        const location =
          item.location ||
          item.placeOfPerformance ||
          "";

        const deadline =
          item.responseDeadline ||
          item.response_deadline ||
          item.deadline ||
          null;

        const description =
          item.description ||
          item.synopsis ||
          "";

        let saved;

        try {
          saved = await query(
            `
            INSERT INTO opportunities (
              id,
              company_id,
              external_notice_id,
              title,
              agency,
              solicitation_number,
              naics_code,
              location,
              set_aside,
              response_deadline,
              description,
              match_score,
              raw_data
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
            )
            ON CONFLICT (
              company_id,
              external_notice_id
            )
            DO UPDATE SET
              title=EXCLUDED.title,
              agency=EXCLUDED.agency,
              solicitation_number=EXCLUDED.solicitation_number,
              naics_code=EXCLUDED.naics_code,
              location=EXCLUDED.location,
              set_aside=EXCLUDED.set_aside,
              response_deadline=EXCLUDED.response_deadline,
              description=EXCLUDED.description,
              raw_data=EXCLUDED.raw_data,
              updated_at=NOW()
            RETURNING id
            `,
            [
              crypto.randomUUID(),
              company.id,
              String(externalNoticeId),
              String(title),
              String(agency),
              String(
                item.solicitationNumber ||
                  item.solicitation_number ||
                  ""
              ),
              String(naics),
              String(location),
              String(
                item.setAside ||
                  item.set_aside ||
                  ""
              ),
              deadline
                ? new Date(deadline)
                : null,
              String(description),
              null,
              item
            ]
          );
        } catch (saveErr) {
          console.error(
            "Opportunity save error:",
            saveErr.message
          );
          continue;
        }

        if (saved.rows[0]) {
          inserted.push(saved.rows[0].id);
        }
      }

      return res.redirect(
        `/hunter?found=${inserted.length}&plan=${encodeURIComponent(
          plan.id
        )}`
      );
    } catch (err) {
      console.error(
        "Hunter search error:",
        err.message
      );

      res
        .status(502)
        .send(
          "Unable to connect to the Hunter service."
        );
    }
  }
);

/*
========================================================
OPPORTUNITY DETAIL
========================================================
*/

app.get(
  "/opportunity/:id",
  requireAuth,
  async (req, res) => {
    try {
      const result = await query(
        `
        SELECT
          o.*,
          c.company_id,
          c.name AS company_name,
          COALESCE(s.plan_id,'free') AS plan_id
        FROM opportunities o
        JOIN companies c
          ON c.id=o.company_id
        JOIN company_memberships cm
          ON cm.company_id=c.id
        LEFT JOIN subscriptions s
          ON s.company_id=c.id
        WHERE o.id=$1
          AND cm.user_id=$2
        LIMIT 1
        `,
        [
          req.params.id,
          req.user.id
        ]
      );

      const opportunity = result.rows[0];

      if (!opportunity) {
        return res
          .status(404)
          .send("Opportunity not found.");
      }

      const plan = getPlan(
        opportunity.plan_id
      );

      const canAnalyze =
        planAllows(
          plan.id,
          "analyzer"
        );

      res.send(
        pageShell(
          "Opportunity",
          `
          <section class="section">

            <div class="badge">
              OPPORTUNITY INTELLIGENCE
            </div>

            <h1>
              ${escapeHtml(
                opportunity.title ||
                  "Government Opportunity"
              )}
            </h1>

            <p class="muted">
              ${escapeHtml(
                opportunity.agency ||
                  "Agency not specified"
              )}
            </p>

            <div class="grid">

              <div class="card">
                <h3>Notice ID</h3>
                <p>
                  ${escapeHtml(
                    opportunity.external_notice_id
                  )}
                </p>
              </div>

              <div class="card">
                <h3>NAICS</h3>
                <p>
                  ${escapeHtml(
                    opportunity.naics_code ||
                      "Not specified"
                  )}
                </p>
              </div>

              <div class="card">
                <h3>Set Aside</h3>
                <p>
                  ${escapeHtml(
                    opportunity.set_aside ||
                      "Not specified"
                  )}
                </p>
              </div>

              <div class="card">
                <h3>Deadline</h3>
                <p>
                  ${
                    opportunity.response_deadline
                      ? new Date(
                          opportunity.response_deadline
                        ).toLocaleString()
                      : "Not specified"
                  }
                </p>
              </div>

            </div>

          </section>

          <section class="section">

            <div class="card">

              <h2>Basic Opportunity Summary</h2>

              <p class="muted">
                ${
                  opportunity.description
                    ? escapeHtml(
                        opportunity.description
                      )
                    : "No description supplied by the source."
                }
              </p>

            </div>

          </section>

          <section class="section">

            <div class="card">

              <h2>InteliBid Intelligence</h2>

              ${
                canAnalyze
                  ? `
                    <p class="muted">
                      Your ${escapeHtml(
                        plan.name
                      )} plan can move this opportunity
                      through the intelligence pipeline.
                    </p>

                    <form method="POST"
                      action="/api/pipeline/start">

                      <input
                        type="hidden"
                        name="opportunityId"
                        value="${escapeHtml(
                          opportunity.id
                        )}"
                      >

                      <button
                        class="btn primary"
                        type="submit"
                      >
                        Analyze Opportunity
                      </button>

                    </form>
                  `
                  : `
                    <div class="notice warning">

                      <strong>
                        Deeper intelligence is a paid feature.
                      </strong>

                      <p>
                        Free provides basic opportunity facts
                        and a limited preview. Upgrade to unlock
                        eligibility, contract analysis,
                        performance intelligence and
                        pricing/profitability.
                      </p>

                      <a
                        class="btn primary"
                        href="/plans"
                      >
                        View Upgrade Options
                      </a>

                    </div>
                  `
              }

            </div>

          </section>
          `
        )
      );
    } catch (err) {
      console.error(
        "Opportunity page error:",
        err.message
      );

      res
        .status(500)
        .send("Unable to load opportunity.");
    }
  }
);

/*
========================================================
PIPELINE START
========================================================
*/

app.post(
  "/api/pipeline/start",
  requireAuth,
  async (req, res) => {
    const opportunityId = String(
      req.body.opportunityId || ""
    );

    if (!opportunityId) {
      return res
        .status(400)
        .send("Opportunity required.");
    }

    try {
      const result = await query(
        `
        SELECT
          o.*,
          c.id AS company_uuid,
          c.company_id,
          COALESCE(s.plan_id,'free') AS plan_id
        FROM opportunities o
        JOIN companies c
          ON c.id=o.company_id
        JOIN company_memberships cm
          ON cm.company_id=c.id
        LEFT JOIN subscriptions s
          ON s.company_id=c.id
        WHERE o.id=$1
          AND cm.user_id=$2
        LIMIT 1
        `,
        [
          opportunityId,
          req.user.id
        ]
      );

      const opportunity = result.rows[0];

      if (!opportunity) {
        return res
          .status(404)
          .send("Opportunity not found.");
      }

      const plan = getPlan(
        opportunity.plan_id
      );

      if (
        plan.id === "free"
      ) {
        return res.redirect(
          `/opportunity/${encodeURIComponent(
            opportunityId
          )}`
        );
      }

      const countResult = await query(
        `
        SELECT COUNT(*)::int AS count
        FROM pipeline_runs
        WHERE company_id=$1
        `,
        [opportunity.company_uuid]
      );

      if (
        Number(countResult.rows[0].count) >=
        plan.maxPipelineRuns
      ) {
        return res
          .status(403)
          .send(
            "Your plan has reached its pipeline usage limit."
          );
      }

      const pipelineId =
        crypto.randomUUID();

      await query(
        `
        INSERT INTO pipeline_runs (
          id,
          company_id,
          opportunity_id,
          current_stage,
          status
        )
        VALUES ($1,$2,$3,2,'active')
        `,
        [
          pipelineId,
          opportunity.company_uuid,
          opportunityId
        ]
      );

      await query(
        `
        INSERT INTO pipeline_events (
          id,
          pipeline_run_id,
          stage_number,
          stage_name,
          status,
          request_payload,
          started_at
        )
        VALUES ($1,$2,2,'Hunter','completed',$3,NOW())
        `,
        [
          crypto.randomUUID(),
          pipelineId,
          {
            opportunity_id: opportunityId,
            company_id:
              opportunity.company_id
          }
        ]
      );

      res.redirect(
        `/pipeline/${encodeURIComponent(
          pipelineId
        )}`
      );
    } catch (err) {
      console.error(
        "Pipeline start error:",
        err.message
      );

      res
        .status(500)
        .send("Unable to start pipeline.");
    }
  }
);

/*
========================================================
PIPELINE PAGE
========================================================
*/

app.get(
  "/pipeline/:pipelineRunId",
  requireAuth,
  async (req, res) => {
    try {
      const runResult = await query(
        `
        SELECT
          pr.*,
          o.title AS opportunity_title,
          o.agency,
          o.external_notice_id,
          c.company_id,
          c.name AS company_name,
          COALESCE(s.plan_id,'free') AS plan_id
        FROM pipeline_runs pr
        JOIN companies c
          ON c.id=pr.company_id
        JOIN company_memberships cm
          ON cm.company_id=c.id
        LEFT JOIN opportunities o
          ON o.id=pr.opportunity_id
        LEFT JOIN subscriptions s
          ON s.company_id=c.id
        WHERE pr.id=$1
          AND cm.user_id=$2
        LIMIT 1
        `,
        [
          req.params.pipelineRunId,
          req.user.id
        ]
      );

      const run = runResult.rows[0];

      if (!run) {
        return res
          .status(404)
          .send("Pipeline run not found.");
      }

      const eventsResult = await query(
        `
        SELECT *
        FROM pipeline_events
        WHERE pipeline_run_id=$1
        ORDER BY created_at ASC
        `,
        [run.id]
      );

      const plan = getPlan(run.plan_id);

      res.send(
        pageShell(
          "Pipeline",
          `
          <section class="section">

            <div class="badge">
              INTELIBID PIPELINE
            </div>

            <h1>
              ${escapeHtml(
                run.opportunity_title ||
                  "Opportunity"
              )}
            </h1>

            <p class="muted">
              ${escapeHtml(
                run.agency || ""
              )}
            </p>

            <div class="grid">

              <div class="card">
                <div class="muted">
                  Company
                </div>
                <div class="stat">
                  ${escapeHtml(
                    run.company_name
                  )}
                </div>
                <div class="muted">
                  ${escapeHtml(
                    run.company_id
                  )}
                </div>
              </div>

              <div class="card">
                <div class="muted">
                  Plan
                </div>
                <div class="stat">
                  ${escapeHtml(
                    plan.name
                  )}
                </div>
              </div>

              <div class="card">
                <div class="muted">
                  Current Stage
                </div>
                <div class="stat">
                  ${run.current_stage}/8
                </div>
              </div>

              <div class="card">
                <div class="muted">
                  Approval
                </div>
                <div class="stat small">
                  ${escapeHtml(
                    run.human_approval_status
                  )}
                </div>
              </div>

            </div>

          </section>

          <section class="section">

            <div class="pipeline">

              ${PIPELINE_STAGES.map(
                (stage) => {
                  const active =
                    run.current_stage ===
                    stage.number;

                  const complete =
                    run.current_stage >
                    stage.number;

                  return `
                    <div
                      class="stage"
                      style="${
                        active
                          ? "border-color:var(--accent)"
                          : ""
                      }"
                    >

                      <div class="stage-number">
                        ${
                          complete
                            ? "✓"
                            : String(
                                stage.number
                              ).padStart(
                                2,
                                "0"
                              )
                        }
                      </div>

                      <div class="stage-name">
                        ${escapeHtml(
                          stage.name
                        )}
                      </div>

                      <div class="stage-tagline">
                        ${escapeHtml(
                          stage.tagline
                        )}
                      </div>

                    </div>
                  `;
                }
              ).join("")}

            </div>

          </section>

          <section class="section">

            <div class="card">

              <h2>Activity & Evidence</h2>

              ${
                eventsResult.rows.length
                  ? eventsResult.rows
                      .map(
                        (event) => `
                          <div class="notice">

                            <strong>
                              Stage
                              ${event.stage_number} —
                              ${escapeHtml(
                                event.stage_name
                              )}
                            </strong>

                            <div class="small muted">
                              Status:
                              ${escapeHtml(
                                event.status
                              )}
                            </div>

                            ${
                              event.evidence
                                ? `
                                  <p>
                                    ${escapeHtml(
                                      event.evidence
                                    )}
                                  </p>
                                `
                                : ""
                            }

                          </div>
                        `
                      )
                      .join("")
                  : `
                    <div class="notice">
                      No activity has been recorded yet.
                    </div>
                  `
              }

            </div>

          </section>

          <section class="section">

            <div class="card">

              <h2>Pipeline Control</h2>

              <p class="muted">
                Stages are recorded with evidence.
                InteliBid does not claim an agent completed
                a stage unless the connected service returns
                a result.
              </p>

              ${
                run.current_stage < 8
                  ? `
                    <form
                      method="POST"
                      action="/api/pipeline/${encodeURIComponent(
                        run.id
                      )}/stage/${run.current_stage + 1}"
                    >

                      <button
                        class="btn primary"
                        type="submit"
                      >
                        Run Stage
                        ${run.current_stage + 1} —
                        ${escapeHtml(
                          PIPELINE_STAGES[
                            run.current_stage
                          ]?.name || ""
                        )}
                      </button>

                    </form>
                  `
                  : `
                    <div class="notice success">
                      Pipeline has reached the Bid Package stage.
                    </div>
                  `
              }

              <hr style="
                border:0;
                border-top:1px solid var(--border);
                margin:25px 0;
              ">

              <h3>Human Approval</h3>

              <p class="muted">
                Human approval remains required before
                any actual bid submission.
              </p>

              <div class="actions"
                style="justify-content:flex-start">

                <form
                  method="POST"
                  action="/api/pipeline/${encodeURIComponent(
                    run.id
                  )}/approval"
                >

                  <input
                    type="hidden"
                    name="status"
                    value="approved"
                  >

                  <button
                    class="btn primary"
                    type="submit"
                  >
                    Approve
                  </button>

                </form>

                <form
                  method="POST"
                  action="/api/pipeline/${encodeURIComponent(
                    run.id
                  )}/approval"
                >

                  <input
                    type="hidden"
                    name="status"
                    value="needs_revision"
                  >

                  <button
                    class="btn secondary"
                    type="submit"
                  >
                    Needs Revision
                  </button>

                </form>

                <form
                  method="POST"
                  action="/api/pipeline/${encodeURIComponent(
                    run.id
                  )}/approval"
                >

                  <input
                    type="hidden"
                    name="status"
                    value="rejected"
                  >

                  <button
                    class="btn danger"
                    type="submit"
                  >
                    Reject
                  </button>

                </form>

              </div>

              <hr style="
                border:0;
                border-top:1px solid var(--border);
                margin:25px 0;
              ">

              <h3>Teaming &amp; Subcontractor Sourcing</h3>

              <p class="muted">
                Find real companies to team or subcontract with on this
                opportunity, sourced from SAM.gov and USASpending.gov.
              </p>

              ${
                planAllows(plan.id, "partner")
                  ? `
                    <div class="actions"
                      style="justify-content:flex-start">

                      <form
                        method="POST"
                        action="/api/pipeline/${encodeURIComponent(
                          run.id
                        )}/teaming-partners"
                      >
                        <button
                          class="btn primary"
                          type="submit"
                        >
                          Find Teaming Partners
                        </button>
                      </form>

                      <a
                        class="btn secondary"
                        href="/pipeline/${encodeURIComponent(
                          run.id
                        )}/partners"
                      >
                        View Candidates
                      </a>

                    </div>
                  `
                  : `
                    <div class="notice">
                      Teaming partner sourcing is available on the
                      Business and Enterprise plans.
                    </div>
                  `
              }

            </div>

          </section>
          `
        )
      );
    } catch (err) {
      console.error(
        "Pipeline page error:",
        err.message
      );

      res
        .status(500)
        .send("Unable to load pipeline.");
    }
  }
);

/*
========================================================
PIPELINE STAGE HANDOFF
========================================================
*/

app.post(
  "/api/pipeline/:pipelineRunId/stage/:stageNumber",
  requireAuth,
  async (req, res) => {
    const stageNumber = Number(
      req.params.stageNumber
    );

    if (
      !Number.isInteger(stageNumber) ||
      stageNumber < 1 ||
      stageNumber > 8
    ) {
      return res
        .status(400)
        .send("Invalid pipeline stage.");
    }

    try {
      const runResult = await query(
        `
        SELECT
          pr.*,
          c.company_id AS public_company_id,
          COALESCE(s.plan_id,'free') AS plan_id
        FROM pipeline_runs pr
        JOIN companies c
          ON c.id=pr.company_id
        JOIN company_memberships cm
          ON cm.company_id=c.id
        LEFT JOIN subscriptions s
          ON s.company_id=c.id
        WHERE pr.id=$1
          AND cm.user_id=$2
        LIMIT 1
        `,
        [
          req.params.pipelineRunId,
          req.user.id
        ]
      );

      const run = runResult.rows[0];

      if (!run) {
        return res
          .status(404)
          .send("Pipeline run not found.");
      }

      const plan = getPlan(run.plan_id);

      const featureByStage = {
        3: "eligibility",
        4: "analyzer",
        5: "performance",
        6: "pricing",
        7: "partner",
        8: "bid_package"
      };

      const feature =
        featureByStage[stageNumber];

      if (
        feature &&
        !planAllows(plan.id, feature)
      ) {
        return res
          .status(403)
          .send(
            `Stage ${stageNumber} is not included in the ${plan.name} plan.`
          );
      }

      const stage = PIPELINE_STAGES.find(
        (item) =>
          item.number === stageNumber
      );

      const serviceKey = {
        3: "eligibility",
        4: "analyzer",
        5: "performer",
        6: "pricing",
        7: "partner",
        8: "partner"
      }[stageNumber];

      const serviceUrl =
        serviceKey
          ? SERVICE_URLS[serviceKey]
          : null;

      const eventId =
        crypto.randomUUID();

      await query(
        `
        INSERT INTO pipeline_events (
          id,
          pipeline_run_id,
          stage_number,
          stage_name,
          status,
          request_payload,
          started_at
        )
        VALUES ($1,$2,$3,$4,'started',$5,NOW())
        `,
        [
          eventId,
          run.id,
          stageNumber,
          stage?.name || `Stage ${stageNumber}`,
          {
            company_id:
              run.public_company_id,
            pipeline_run_id: run.id,
            opportunity_id:
              run.opportunity_id
          }
        ]
      );

      let status = "not_configured";
      let responseData = {};
      let evidence =
        "No external agent endpoint is configured for this stage.";

      if (serviceUrl) {
        try {
          const response =
            await fetchWithTimeout(
              serviceUrl.replace(/\/$/, ""),
              {
                method: "POST",
                headers: {
                  "Content-Type":
                    "application/json",
                  Accept:
                    "application/json"
                },
                body: JSON.stringify({
                  company_id:
                    run.public_company_id,
                  pipeline_run_id: run.id,
                  opportunity_id:
                    run.opportunity_id,
                  stage: stageNumber
                })
              },
              30000
            );

          responseData =
            await readJsonResponse(response);

          status = response.ok
            ? "completed"
            : "error";

          evidence = response.ok
            ? "Connected agent returned a response."
            : `Connected agent returned HTTP ${response.status}.`;
        } catch (err) {
          status = "error";

          evidence =
            `Agent connection failed: ${err.message}`;
        }
      }

      await query(
        `
        UPDATE pipeline_events
        SET
          status=$1,
          response_payload=$2,
          evidence=$3,
          completed_at=NOW()
        WHERE id=$4
        `,
        [
          status,
          responseData,
          evidence,
          eventId
        ]
      );

      if (status === "completed") {
        await query(
          `
          UPDATE pipeline_runs
          SET
            current_stage=GREATEST(
              current_stage,
              $1
            ),
            updated_at=NOW()
          WHERE id=$2
          `,
          [
            stageNumber,
            run.id
          ]
        );
      }

      res.redirect(
        `/pipeline/${encodeURIComponent(
          run.id
        )}`
      );
    } catch (err) {
      console.error(
        "Pipeline stage error:",
        err.message
      );

      res
        .status(500)
        .send("Unable to run pipeline stage.");
    }
  }
);

app.post(
  "/api/pipeline/:pipelineRunId/approval",
  requireAuth,
  async (req, res) => {
    const allowed = [
      "approved",
      "needs_revision",
      "rejected"
    ];

    const status = String(
      req.body.status || ""
    );

    if (!allowed.includes(status)) {
      return res
        .status(400)
        .send("Invalid approval status.");
    }

    try {
      const result = await query(
        `
        UPDATE pipeline_runs pr
        SET
          human_approval_status=$1,
          updated_at=NOW()
        FROM company_memberships cm
        WHERE pr.id=$2
          AND cm.company_id=pr.company_id
          AND cm.user_id=$3
        RETURNING pr.id
        `,
        [
          status,
          req.params.pipelineRunId,
          req.user.id
        ]
      );

      if (!result.rows.length) {
        return res
          .status(404)
          .send("Pipeline not found.");
      }

      res.redirect(
        `/pipeline/${encodeURIComponent(
          req.params.pipelineRunId
        )}`
      );
    } catch (err) {
      console.error(
        "Approval error:",
        err.message
      );

      res
        .status(500)
        .send("Unable to save approval.");
    }
  }
);

/*
========================================================
TEAMING PARTNER SOURCING ROUTES
========================================================
*/

app.post(
  "/api/pipeline/:pipelineRunId/teaming-partners",
  requireAuth,
  async (req, res) => {
    try {
      const runResult = await query(
        `
        SELECT
          pr.id,
          o.naics_code,
          o.agency,
          c.state AS company_state,
          COALESCE(s.plan_id,'free') AS plan_id
        FROM pipeline_runs pr
        JOIN companies c
          ON c.id=pr.company_id
        JOIN company_memberships cm
          ON cm.company_id=c.id
        LEFT JOIN opportunities o
          ON o.id=pr.opportunity_id
        LEFT JOIN subscriptions s
          ON s.company_id=c.id
        WHERE pr.id=$1
          AND cm.user_id=$2
        LIMIT 1
        `,
        [
          req.params.pipelineRunId,
          req.user.id
        ]
      );

      const run = runResult.rows[0];

      if (!run) {
        return res
          .status(404)
          .send("Pipeline run not found.");
      }

      const plan = getPlan(run.plan_id);

      if (!planAllows(plan.id, "partner")) {
        return res
          .status(403)
          .send(
            `Teaming partner sourcing is not included in the ${plan.name} plan.`
          );
      }

      const naicsCode =
        String(run.naics_code || "")
          .split(/[,\s]+/)
          .filter(Boolean)[0] || null;

      if (!naicsCode) {
        return res
          .status(400)
          .send(
            "This opportunity has no NAICS code on file yet, so teaming partners can't be sourced."
          );
      }

      const eventId = crypto.randomUUID();

      await query(
        `
        INSERT INTO pipeline_events (
          id,
          pipeline_run_id,
          stage_number,
          stage_name,
          status,
          request_payload,
          started_at
        )
        VALUES ($1,$2,7,'Teaming Partner Sourcing','started',$3,NOW())
        `,
        [
          eventId,
          run.id,
          {
            naics_code: naicsCode,
            agency: run.agency,
            sam_gov_configured: Boolean(SAM_API_KEY)
          }
        ]
      );

      const [samResults, spendingResults] = await Promise.all([
        searchSamEntities({
          naicsCode,
          state: run.company_state
        }),
        searchUsaSpendingPartners({
          naicsCode,
          agency: run.agency
        })
      ]);

      const candidates = [
        ...samResults,
        ...spendingResults
      ];

      await query(
        `DELETE FROM teaming_candidates WHERE pipeline_run_id=$1`,
        [run.id]
      );

      for (const candidate of candidates) {
        await query(
          `
          INSERT INTO teaming_candidates (
            id,
            pipeline_run_id,
            source,
            entity_name,
            uei,
            naics_codes,
            set_aside_types,
            state,
            city,
            website,
            match_reason,
            award_amount,
            raw_data
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          `,
          [
            crypto.randomUUID(),
            run.id,
            candidate.source,
            candidate.entity_name,
            candidate.uei,
            candidate.naics_codes,
            candidate.set_aside_types,
            candidate.state,
            candidate.city,
            candidate.website,
            candidate.match_reason,
            candidate.award_amount,
            safeJson(candidate.raw_data)
          ]
        );
      }

      const evidence = candidates.length
        ? `Found ${candidates.length} potential teaming partner(s) from SAM.gov and USASpending.gov for NAICS ${naicsCode}.`
        : SAM_API_KEY
          ? `No teaming partner candidates found for NAICS ${naicsCode}.`
          : `No SAM_API_KEY is configured, so only USASpending.gov results were checked for NAICS ${naicsCode}. Add SAM_API_KEY in Railway to include SAM.gov registrations.`;

      await query(
        `
        UPDATE pipeline_events
        SET
          status='completed',
          response_payload=$1,
          evidence=$2,
          completed_at=NOW()
        WHERE id=$3
        `,
        [
          { candidate_count: candidates.length },
          evidence,
          eventId
        ]
      );

      res.redirect(
        `/pipeline/${encodeURIComponent(run.id)}/partners`
      );
    } catch (err) {
      console.error(
        "Teaming partner sourcing error:",
        err.message
      );

      res
        .status(500)
        .send("Unable to source teaming partners right now.");
    }
  }
);

app.get(
  "/pipeline/:pipelineRunId/partners",
  requireAuth,
  async (req, res) => {
    try {
      const runResult = await query(
        `
        SELECT
          pr.id,
          o.title AS opportunity_title,
          o.naics_code,
          o.agency
        FROM pipeline_runs pr
        JOIN companies c
          ON c.id=pr.company_id
        JOIN company_memberships cm
          ON cm.company_id=c.id
        LEFT JOIN opportunities o
          ON o.id=pr.opportunity_id
        WHERE pr.id=$1
          AND cm.user_id=$2
        LIMIT 1
        `,
        [
          req.params.pipelineRunId,
          req.user.id
        ]
      );

      const run = runResult.rows[0];

      if (!run) {
        return res
          .status(404)
          .send("Pipeline run not found.");
      }

      const candidatesResult = await query(
        `
        SELECT *
        FROM teaming_candidates
        WHERE pipeline_run_id=$1
        ORDER BY award_amount DESC NULLS LAST, entity_name ASC
        `,
        [run.id]
      );

      res.send(
        pageShell(
          "Teaming Partners",
          `
          <section class="section">

            <div class="badge">
              TEAMING &amp; SUBCONTRACTOR SOURCING
            </div>

            <h1>
              ${escapeHtml(
                run.opportunity_title || "Opportunity"
              )}
            </h1>

            <p class="muted">
              NAICS ${escapeHtml(run.naics_code || "—")} ·
              ${escapeHtml(run.agency || "")}
            </p>

            <p class="muted">
              Candidates below come from SAM.gov active registrations
              and USASpending.gov award history. InteliBid surfaces the
              match — vetting fit and capacity, and putting a teaming
              agreement in place, is still on you. This is not legal advice.
            </p>

          </section>

          <section class="section">

            <div class="grid">

              ${
                candidatesResult.rows.length
                  ? candidatesResult.rows
                      .map(
                        (c) => `
                        <div class="card">

                          <div class="stat small">
                            ${escapeHtml(c.entity_name)}
                          </div>

                          <div class="muted small">
                            ${escapeHtml(
                              c.source === "sam_gov"
                                ? "SAM.gov registration"
                                : "USASpending award history"
                            )}
                          </div>

                          ${
                            c.uei
                              ? `<div class="muted small">UEI: ${escapeHtml(
                                  c.uei
                                )}</div>`
                              : ""
                          }

                          ${
                            c.city || c.state
                              ? `<div class="muted small">${escapeHtml(
                                  [c.city, c.state]
                                    .filter(Boolean)
                                    .join(", ")
                                )}</div>`
                              : ""
                          }

                          ${
                            c.set_aside_types
                              ? `<div class="muted small">${escapeHtml(
                                  c.set_aside_types
                                )}</div>`
                              : ""
                          }

                          ${
                            c.award_amount
                              ? `<div class="muted small">Prior award: $${Number(
                                  c.award_amount
                                ).toLocaleString()}</div>`
                              : ""
                          }

                          <p class="small">
                            ${escapeHtml(c.match_reason || "")}
                          </p>

                          ${
                            c.website
                              ? `<a class="btn secondary" href="${escapeHtml(
                                  c.website
                                )}" target="_blank" rel="noopener">Visit site</a>`
                              : ""
                          }

                        </div>
                        `
                      )
                      .join("")
                  : `
                    <div class="notice">
                      No candidates yet. Go back to the pipeline and run
                      "Find Teaming Partners".
                      ${
                        SAM_API_KEY
                          ? ""
                          : " SAM_API_KEY is not set in Railway, so results will be limited to USASpending.gov."
                      }
                    </div>
                  `
              }

            </div>

          </section>

          <section class="section">
            <a
              class="btn secondary"
              href="/pipeline/${encodeURIComponent(run.id)}"
            >
              Back to Pipeline
            </a>
          </section>
          `
        )
      );
    } catch (err) {
      console.error(
        "Teaming partners page error:",
        err.message
      );

      res
        .status(500)
        .send("Unable to load teaming partners.");
    }
  }
);

/*
========================================================
CONTRACT INTELLIGENCE
========================================================
*/

app.get(
  "/contracts",
  requireAuth,
  async (req, res) => {
    try {
      const companies = await getUserCompanies(
        req.user.id
      );

      const company = companies[0];

      if (!company) {
        return res.redirect("/company-profile");
      }

      const plan = getPlan(
        company.plan_id
      );

      const contracts = await query(
        `
        SELECT *
        FROM contracts
        WHERE company_id=$1
        ORDER BY expiration_date ASC NULLS LAST
        `,
        [company.id]
      );

      const canUseContracts =
        planAllows(
          plan.id,
          "contracts"
        );

      res.send(
        pageShell(
          "Contract Intelligence",
          `
          <section class="section">

            <div class="badge">
              CONTRACT INTELLIGENCE
            </div>

            <h1>
              Never lose track of an expiration or renewal.
            </h1>

            <p class="muted">
              InteliBid monitors contract dates and identifies
              contracts that are approaching expiration or renewal.
            </p>

            ${
              !canUseContracts
                ? `
                  <div class="notice warning">

                    <strong>
                      Contract monitoring is available
                      on paid plans.
                    </strong>

                    <p>
                      Free gives you basic opportunity discovery.
                      Upgrade to activate contract tracking.
                    </p>

                    <a
                      class="btn primary"
                      href="/plans"
                    >
                      Upgrade
                    </a>

                  </div>
                `
                : ""
            }

          </section>

          ${
            canUseContracts
              ? `
                <section class="section">

                  <div class="card">

                    <h2>Add Contract</h2>

                    <form
                      method="POST"
                      action="/api/contracts"
                    >

                      <label>Contract Title</label>

                      <input
                        name="title"
                        required
                        placeholder="Custodial Services Contract"
                      >

                      <label>Contract Number</label>

                      <input
                        name="contract_number"
                        placeholder="Contract number"
                      >

                      <label>Agency</label>

                      <input
                        name="agency"
                        placeholder="Federal agency"
                      >

                      <label>Contract Value</label>

                      <input
                        name="contract_value"
                        type="number"
                        step="0.01"
                        placeholder="500000"
                      >

                      <label>Start Date</label>

                      <input
                        name="start_date"
                        type="date"
                      >

                      <label>Expiration Date</label>

                      <input
                        name="expiration_date"
                        type="date"
                      >

                      <label>Renewal Date</label>

                      <input
                        name="renewal_date"
                        type="date"
                      >

                      <label>Option Date</label>

                      <input
                        name="option_date"
                        type="date"
                      >

                      <label>
                        <input
                          type="checkbox"
                          name="auto_renew"
                          value="true"
                          style="width:auto"
                        >
                        Auto renewal
                      </label>

                      <label>Notes</label>

                      <textarea
                        name="notes"
                      ></textarea>

                      <button
                        class="btn primary"
                        type="submit"
                        style="margin-top:15px"
                      >
                        Track Contract
                      </button>

                    </form>

                  </div>

                </section>

                <section class="section">

                  <h2>Contract Watchlist</h2>

                  ${
                    contracts.rows.length
                      ? `
                        <div class="grid">

                          ${contracts.rows
                            .map(
                              (contract) => {
                                const status =
                                  contractStatus(
                                    contract
                                  );

                                const expirationDays =
                                  daysBetween(
                                    contract.expiration_date
                                  );

                                const renewalDays =
                                  daysBetween(
                                    contract.renewal_date
                                  );

                                return `
                                  <div class="card">

                                    <div class="badge">
                                      ${escapeHtml(
                                        status
                                          .replace(
                                            "_",
                                            " "
                                          )
                                          .toUpperCase()
                                      )}
                                    </div>

                                    <h3>
                                      ${escapeHtml(
                                        contract.title
                                      )}
                                    </h3>

                                    <p class="muted">
                                      ${escapeHtml(
                                        contract.agency ||
                                          ""
                                      )}
                                    </p>

                                    <p>
                                      <strong>
                                        Expiration:
                                      </strong>
                                      ${
                                        contract.expiration_date
                                          ? new Date(
                                              contract.expiration_date
                                            ).toLocaleDateString()
                                          : "Not set"
                                      }
                                    </p>

                                    <p>
                                      ${
                                        expirationDays ===
                                        null
                                          ? "Expiration countdown unavailable."
                                          : expirationDays < 0
                                          ? `Expired ${Math.abs(
                                              expirationDays
                                            )} days ago.`
                                          : `${expirationDays} days until expiration.`
                                      }
                                    </p>

                                    <p>
                                      <strong>
                                        Renewal:
                                      </strong>
                                      ${
                                        contract.renewal_date
                                          ? new Date(
                                              contract.renewal_date
                                            ).toLocaleDateString()
                                          : "Not set"
                                      }
                                    </p>

                                    ${
                                      renewalDays !== null
                                        ? `
                                          <p class="muted">
                                            ${
                                              renewalDays < 0
                                                ? `Renewal date passed ${Math.abs(
                                                    renewalDays
                                                  )} days ago.`
                                                : `${renewalDays} days until renewal.`
                                            }
                                          </p>
                                        `
                                        : ""
                                    }

                                    ${
                                      status ===
                                      "renewal_due"
                                        ? `
                                          <div class="notice warning">
                                            Renewal action should be reviewed.
                                          </div>
                                        `
                                        : ""
                                    }

                                    ${
                                      status ===
                                      "expiring_soon"
                                        ? `
                                          <div class="notice warning">
                                            Contract expiration is within 90 days.
                                          </div>
                                        `
                                        : ""
                                    }

                                  </div>
                                `;
                              }
                            )
                            .join("")}

                        </div>
                      `
                      : `
                        <div class="notice">
                          No contracts are currently being tracked.
                        </div>
                      `
                  }

                </section>
              `
              : ""
          }
          `
        )
      );
    } catch (err) {
      console.error(
        "Contracts page error:",
        err.message
      );

      res
        .status(500)
        .send("Unable to load contracts.");
    }
  }
);

app.post(
  "/api/contracts",
  requireAuth,
  async (req, res) => {
    try {
      const companies = await getUserCompanies(
        req.user.id
      );

      const company = companies[0];

      if (!company) {
        return res
          .status(404)
          .send("Company not found.");
      }

      const plan = getPlan(
        company.plan_id
      );

      if (
        !planAllows(
          plan.id,
          "contracts"
        )
      ) {
        return res
          .status(403)
          .send(
            "Contract tracking requires a paid plan."
          );
      }

      const title = String(
        req.body.title || ""
      ).trim();

      if (!title) {
        return res
          .status(400)
          .send("Contract title required.");
      }

      const result = await query(
        `
        INSERT INTO contracts (
          id,
          company_id,
          contract_number,
          title,
          agency,
          start_date,
          expiration_date,
          renewal_date,
          option_date,
          auto_renew,
          contract_value,
          notes,
          status
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active'
        )
        RETURNING id
        `,
        [
          crypto.randomUUID(),
          company.id,
          req.body.contract_number || "",
          title,
          req.body.agency || "",
          req.body.start_date || null,
          req.body.expiration_date || null,
          req.body.renewal_date || null,
          req.body.option_date || null,
          req.body.auto_renew === "true",
          req.body.contract_value || null,
          req.body.notes || ""
        ]
      );

      await query(
        `
        INSERT INTO contract_events (
          id,
          contract_id,
          event_type,
          event_date,
          message
        )
        VALUES (
          $1,$2,'created',CURRENT_DATE,$3
        )
        `,
        [
          crypto.randomUUID(),
          result.rows[0].id,
          "Contract added to InteliBid monitoring."
        ]
      );

      res.redirect("/contracts");
    } catch (err) {
      console.error(
        "Create contract error:",
        err.message
      );

      res
        .status(500)
        .send("Unable to create contract.");
    }
  }
);

app.get(
  "/api/contracts",
  requireAuth,
  async (req, res) => {
    try {
      const companies = await getUserCompanies(
        req.user.id
      );

      const company = companies[0];

      if (!company) {
        return res
          .status(404)
          .json({
            error: "Company not found"
          });
      }

      const result = await query(
        `
        SELECT *
        FROM contracts
        WHERE company_id=$1
        ORDER BY expiration_date ASC NULLS LAST
        `,
        [company.id]
      );

      res.json({
        contracts: result.rows.map(
          (contract) => ({
            ...contract,
            calculated_status:
              contractStatus(contract),
            expiration_days:
              daysBetween(
                contract.expiration_date
              ),
            renewal_days:
              daysBetween(
                contract.renewal_date
              )
          })
        )
      });
    } catch (err) {
      console.error(err);

      res
        .status(500)
        .json({
          error: "Unable to load contracts"
        });
    }
  }
);

/*
========================================================
AUTOMATIC CONTRACT MONITOR
========================================================
*/

async function runContractMonitor() {
  if (!databaseReady) {
    return;
  }

  try {
    const result = await query(`
      SELECT *
      FROM contracts
      WHERE
        expiration_date IS NOT NULL
        OR renewal_date IS NOT NULL
    `);

    for (const contract of result.rows) {
      const status =
        contractStatus(contract);

      if (
        contract.status !== status
      ) {
        await query(
          `
          UPDATE contracts
          SET
            status=$1,
            updated_at=NOW()
          WHERE id=$2
          `,
          [
            status,
            contract.id
          ]
        );

        let message =
          `Contract status automatically updated to ${status}.`;

        if (status === "expired") {
          message =
            "Contract expiration date has passed.";
        }

        if (status === "expiring_soon") {
          message =
            "Contract expiration is within 90 days.";
        }

        if (status === "renewal_due") {
          message =
            "Contract renewal date is within 90 days.";
        }

        await query(
          `
          INSERT INTO contract_events (
            id,
            contract_id,
            event_type,
            event_date,
            message
          )
          VALUES (
            $1,$2,$3,CURRENT_DATE,$4
          )
          `,
          [
            crypto.randomUUID(),
            contract.id,
            status,
            message
          ]
        );
      }
    }

    console.log(
      `Contract monitor checked ${result.rows.length} contracts.`
    );
  } catch (err) {
    console.error(
      "Contract monitor error:",
      err.message
    );
  }
}

/*
========================================================
BILLING — STRIPE SELF-SERVICE
========================================================
*/

app.get(
  "/api/billing/checkout",
  requireAuth,
  async (req, res) => {
    const planId = String(
      req.query.plan || ""
    ).toLowerCase();

    const plan = getPlan(planId);

    if (
      plan.id === "free"
    ) {
      return res.redirect("/dashboard");
    }

    if (
      !STRIPE_SECRET_KEY ||
      !STRIPE_PRICE_IDS[plan.id]
    ) {
      return res.redirect(
        `/plans?billing=not_configured&plan=${encodeURIComponent(
          plan.id
        )}`
      );
    }

    try {
      const companies = await getUserCompanies(
        req.user.id
      );

      const company = companies[0];

      if (!company) {
        return res
          .status(404)
          .send("Company not found.");
      }

      const params =
        new URLSearchParams();

      params.append(
        "mode",
        "subscription"
      );

      params.append(
        "line_items[0][price]",
        STRIPE_PRICE_IDS[plan.id]
      );

      params.append(
        "line_items[0][quantity]",
        "1"
      );

      params.append(
        "success_url",
        `${getBaseUrl(req)}/billing/success?session_id={CHECKOUT_SESSION_ID}`
      );

      params.append(
        "cancel_url",
        `${getBaseUrl(req)}/plans`
      );

      params.append(
        "customer_email",
        req.user.email
      );

      params.append(
        "client_reference_id",
        company.id
      );

      params.append(
        "metadata[company_id]",
        company.id
      );

      params.append(
        "metadata[plan_id]",
        plan.id
      );

      const response =
        await fetchWithTimeout(
          "https://api.stripe.com/v1/checkout/sessions",
          {
            method: "POST",
            headers: {
              Authorization:
                `Bearer ${STRIPE_SECRET_KEY}`,
              "Content-Type":
                "application/x-www-form-urlencoded"
            },
            body: params.toString()
          },
          30000
        );

      const data =
        await readJsonResponse(response);

      if (
        !response.ok ||
        !data.url
      ) {
        console.error(
          "Stripe checkout error:",
          safeJson(data)
        );

        return res
          .status(502)
          .send(
            "Unable to start secure checkout."
          );
      }

      res.redirect(data.url);
    } catch (err) {
      console.error(
        "Billing error:",
        err.message
      );

      res
        .status(500)
        .send(
          "Unable to start billing."
        );
    }
  }
);

app.get(
  "/billing/success",
  requireAuth,
  async (req, res) => {
    res.send(
      pageShell(
        "Billing",
        `
        <section class="hero">

          <div class="badge">
            PAYMENT PROCESSING
          </div>

          <h1>
            You're almost there.
          </h1>

          <p>
            Your subscription is being confirmed.
            InteliBid will activate the plan automatically
            after Stripe confirms the payment.
          </p>

          <div class="actions">
            <a
              class="btn primary"
              href="/dashboard"
            >
              Go to Dashboard
            </a>
          </div>

        </section>
        `
      )
    );
  }
);

function getBaseUrl(req) {
  const forwardedProto =
    req.headers["x-forwarded-proto"];

  const protocol =
    forwardedProto ||
    req.protocol ||
    "https";

  const host =
    req.get("host");

  return `${protocol}://${host}`;
}

/*
========================================================
STRIPE WEBHOOK
========================================================
*/

function verifyStripeSignature(
  payload,
  signature,
  secret
) {
  if (!signature || !secret) {
    return false;
  }

  const parts = signature
    .split(",")
    .map((part) => part.split("="));

  const timestamp =
    parts.find(
      ([key]) => key === "t"
    )?.[1];

  const signatures =
    parts
      .filter(
        ([key]) => key === "v1"
      )
      .map(([, value]) => value);

  if (
    !timestamp ||
    !signatures.length
  ) {
    return false;
  }

  const timestampNumber =
    Number(timestamp);

  if (
    !Number.isFinite(timestampNumber)
  ) {
    return false;
  }

  const age =
    Math.abs(
      Date.now() / 1000 -
        timestampNumber
    );

  if (age > 300) {
    return false;
  }

  const signedPayload =
    `${timestamp}.${payload}`;

  const expected =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(signedPayload)
      .digest("hex");

  return signatures.some(
    (candidate) => {
      try {
        return crypto.timingSafeEqual(
          Buffer.from(candidate),
          Buffer.from(expected)
        );
      } catch {
        return false;
      }
    }
  );
}

app.post(
  "/api/billing/webhook",
  async (req, res) => {
    if (!STRIPE_WEBHOOK_SECRET) {
      return res
        .status(503)
        .send(
          "Stripe webhook is not configured."
        );
    }

    const signature =
      req.headers[
        "stripe-signature"
      ];

    if (!Buffer.isBuffer(req.rawBody)) {
      return res
        .status(400)
        .send("Raw request body unavailable.");
    }

    const rawBody =
      req.rawBody.toString("utf8");

    if (
      !verifyStripeSignature(
        rawBody,
        signature,
        STRIPE_WEBHOOK_SECRET
      )
    ) {
      return res
        .status(400)
        .send(
          "Invalid Stripe signature."
        );
    }

    try {
      const event =
        JSON.parse(rawBody);

      if (
        event.type ===
        "checkout.session.completed"
      ) {
        const session =
          event.data.object;

        const companyId =
          session.metadata?.company_id ||
          session.client_reference_id;

        const planId =
          session.metadata?.plan_id;

        if (
          companyId &&
          PLANS[planId]
        ) {
          await query(
            `
            UPDATE subscriptions
            SET
              plan_id=$1,
              status='active',
              stripe_customer_id=$2,
              stripe_subscription_id=$3,
              updated_at=NOW()
            WHERE company_id=$4
            `,
            [
              planId,
              session.customer || null,
              session.subscription || null,
              companyId
            ]
          );

          console.log(
            `Stripe activated ${planId} for company ${companyId}`
          );
        }
      }

      if (
        event.type ===
        "customer.subscription.updated"
      ) {
        const subscription =
          event.data.object;

        const stripeSubscriptionId =
          subscription.id;

        await query(
          `
          UPDATE subscriptions
          SET
            status=$1,
            current_period_start=
              TO_TIMESTAMP($2),
            current_period_end=
              TO_TIMESTAMP($3),
            updated_at=NOW()
          WHERE stripe_subscription_id=$4
          `,
          [
            subscription.status,
            subscription.current_period_start ||
              null,
            subscription.current_period_end ||
              null,
            stripeSubscriptionId
          ]
        );
      }

      if (
        event.type ===
        "customer.subscription.deleted"
      ) {
        const subscription =
          event.data.object;

        await query(
          `
          UPDATE subscriptions
          SET
            status='canceled',
            updated_at=NOW()
          WHERE stripe_subscription_id=$1
          `,
          [subscription.id]
        );
      }

      res.json({
        received: true
      });
    } catch (err) {
      console.error(
        "Stripe webhook error:",
        err.message
      );

      res
        .status(500)
        .send(
          "Webhook processing failed."
        );
    }
  }
);

/*
========================================================
STATUS / HEALTH
========================================================
*/

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "intelibid",
    version: "5.3.0",
    database: databaseReady,
    timestamp: new Date().toISOString()
  });
});

app.get(
  "/api/database/health",
  async (req, res) => {
    if (!pool) {
      return res.status(503).json({
        ok: false,
        database: false,
        error:
          "DATABASE_URL is not configured"
      });
    }

    try {
      await query("SELECT 1");

      res.json({
        ok: true,
        database: true
      });
    } catch (err) {
      res.status(503).json({
        ok: false,
        database: false,
        error: err.message
      });
    }
  }
);

app.get("/api/status", (req, res) => {
  res.json({
    application: "InteliBid",
    architecture: "5.0 Gov/Con",
    version: "5.3.0",
    human_approval_required: true,
    automatic_submission: false,
    database: databaseReady,
    stripe_configured:
      Boolean(STRIPE_SECRET_KEY),
    services: {
      hunter: Boolean(
        SERVICE_URLS.hunter
      ),
      eligibility: Boolean(
        SERVICE_URLS.eligibility
      ),
      analyzer: Boolean(
        SERVICE_URLS.analyzer
      ),
      performer: Boolean(
        SERVICE_URLS.performer
      ),
      pricing: Boolean(
        SERVICE_URLS.pricing
      ),
      partner: Boolean(
        SERVICE_URLS.partner
      )
    },
    teaming_partner_sourcing: {
      usaspending_gov: true,
      sam_gov_configured: Boolean(SAM_API_KEY)
    }
  });
});

app.get(
  "/api/services/health",
  async (req, res) => {
    const services = {};

    for (const [
      name,
      url
    ] of Object.entries(
      SERVICE_URLS
    )) {
      try {
        const response =
          await fetchWithTimeout(
            `${url.replace(
              /\/$/,
              ""
            )}/health`,
            {
              headers: {
                Accept:
                  "application/json"
              }
            },
            10000
          );

        services[name] = {
          ok: response.ok,
          status: response.status
        };
      } catch (err) {
        services[name] = {
          ok: false,
          error: err.message
        };
      }
    }

    res.json({
      ok: true,
      services
    });
  }
);

/*
========================================================
404
========================================================
*/

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "Not found"
    });
  }

  res.status(404).send(
    pageShell(
      "Not Found",
      `
      <section class="hero">

        <div class="badge">
          404
        </div>

        <h1>
          Page not found.
        </h1>

        <p>
          The InteliBid operating system could not find
          that page.
        </p>

        <div class="actions">
          <a
            class="btn primary"
            href="/"
          >
            Return Home
          </a>
        </div>

      </section>
      `
    )
  );
});

/*
========================================================
ERROR HANDLER
========================================================
*/

app.use(
  (err, req, res, next) => {
    console.error(
      "Unhandled application error:",
      err
    );

    if (res.headersSent) {
      return next(err);
    }

    if (
      req.path.startsWith("/api/")
    ) {
      return res.status(500).json({
        error:
          "Internal server error"
      });
    }

    res
      .status(500)
      .send(
        pageShell(
          "Server Error",
          `
          <section class="hero">

            <div class="badge">
              INTELIBID
            </div>

            <h1>
              Something went wrong.
            </h1>

            <p>
              The application is still online.
              Please try again.
            </p>

            <div class="actions">
              <a
                class="btn primary"
                href="/"
              >
                Return Home
              </a>
            </div>

          </section>
          `
        )
      );
  }
);

/*
========================================================
INTELIBID 5.3 STARTUP
========================================================

One HTTP listener, one database retry loop, and one contract
monitor. The application remains online while PostgreSQL
recovers from a temporary outage.
========================================================
*/

async function startServer() {
  await initializeDatabase();

  const server = app.listen(
    PORT,
    HOST,
    () => {
      console.log(
        "=================================================="
      );
      console.log(
        "INTELIBID 5.3 — GOV/CON"
      );
      console.log(
        "Intelligent Bidding. Smarter Contracts."
      );
      console.log(
        "=================================================="
      );
      console.log(
        `Server listening on ${HOST}:${PORT}`
      );
      console.log(
        `Database ready: ${databaseReady}`
      );
      console.log(
        `Configured agents: ${Object.values(SERVICE_URLS).filter(Boolean).length}/${Object.keys(SERVICE_URLS).length}`
      );
      console.log(
        "Contract monitor: every 15 minutes"
      );
      console.log(
        "Human approval before submission: REQUIRED"
      );

      if (databaseReady) {
        void runContractMonitor();
      }
    }
  );

  const dbRetryTimer = setInterval(
    async () => {
      if (!databaseReady && pool) {
        try {
          await initializeDatabase();

          if (databaseReady) {
            await runContractMonitor();
          }
        } catch (error) {
          console.error(
            "Database retry failed:",
            error.message
          );
        }
      }
    },
    60000
  );

  const monitorTimer = setInterval(
    () => {
      void runContractMonitor();
    },
    15 * 60 * 1000
  );

  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    console.log(
      `${signal} received. Shutting down InteliBid 5.3...`
    );

    clearInterval(dbRetryTimer);
    clearInterval(monitorTimer);

    server.close(async () => {
      try {
        if (pool) {
          await pool.end();
        }
      } catch (error) {
        console.error(
          "Database shutdown error:",
          error.message
        );
      }

      process.exit(0);
    });
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

startServer().catch((error) => {
  console.error(
    "Fatal InteliBid 5.3 startup error:",
    error
  );
  process.exit(1);
});
